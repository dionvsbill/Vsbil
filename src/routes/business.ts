import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { supabase } from "../config/supabase.js";
import {
  requireAuth,
  requireIdentity,
} from "../middleware/authMiddleware.js";
const router = Router();
const money = (n: unknown): number => {
  const value = Number(n);
  return Number.isFinite(value) && value >= 0 ? value : 0;
};
const slug = (v: unknown): string =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 70);
const id = (): string => crypto.randomUUID();
type InvoiceItem = {
  description: string;
  quantity: number;
  unit_price: number;
};
type ChurchOfferingEntry = {
  category: string;
  amount: number;
  method: string;
  note: string;
};
/* =========================================================
   BUSINESS SUITE
   Inventory • Invoices • Landlord • Church • Funeral
   All authenticated writes are tenant-scoped to req.user.id.
   ========================================================= */
/* =========================================================
   BUSINESS OVERVIEW
   ========================================================= */
router.get(
  "/overview",
  requireAuth,
  async (req: Request, res: Response) => {
    const uid = req.user!.id;
    try {
      const [
        shops,
        invoices,
        properties,
        offerings,
        funerals,
      ] = await Promise.all([
        supabase
          .from("business_shops")
          .select("id,name,currency,created_at")
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("business_invoices")
          .select(
            "id,invoice_number,client_name,total,status,due_date,created_at",
          )
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("landlord_properties")
          .select(
            "id,name,address,rent_amount,rent_cycle,created_at",
          )
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("church_offerings")
          .select(
            "id,church_name,offering_date,total_amount,created_at",
          )
          .eq("user_id", uid)
          .order("offering_date", { ascending: false })
          .limit(10),
        supabase
          .from("funeral_campaigns")
          .select(
            "id,title,slug,target_amount,amount_raised,status,created_at",
          )
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);
      const firstError = [
        shops,
        invoices,
        properties,
        offerings,
        funerals,
      ].find(
        (
          result:
            | typeof shops
            | typeof invoices
            | typeof properties
            | typeof offerings
            | typeof funerals,
        ) => result.error,
      )?.error;
      if (firstError) {
        throw firstError;
      }
      return res.json({
        success: true,
        shops: shops.data ?? [],
        invoices: invoices.data ?? [],
        properties: properties.data ?? [],
        offerings: offerings.data ?? [],
        funerals: funerals.data ?? [],
      });
    } catch (error) {
      console.error("Business overview error:", error);
      return res.status(500).json({
        success: false,
        message: "Unable to load business suite",
      });
    }
  },
);
/* =========================================================
   SHOP INVENTORY
   ========================================================= */
router.post(
  "/shops",
  requireAuth,
  async (req: Request, res: Response) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name || name.length > 120) {
      return res.status(400).json({
        success: false,
        message: "Shop name is required",
      });
    }
    const { data, error } = await supabase
      .from("business_shops")
      .insert({
        id: id(),
        user_id: req.user!.id,
        name,
        phone: String(req.body?.phone ?? "").trim(),
        address: String(req.body?.address ?? "").trim(),
        currency: "GHS",
      })
      .select()
      .single();
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    return res.status(201).json({
      success: true,
      shop: data,
    });
  },
);
router.get(
  "/shops/:shopId/products",
  requireAuth,
  async (req: Request, res: Response) => {
    const { data: shop } = await supabase
      .from("business_shops")
      .select("id")
      .eq("id", req.params.shopId)
      .eq("user_id", req.user!.id)
      .maybeSingle();
    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }
    const { data, error } = await supabase
      .from("inventory_products")
      .select("*")
      .eq("shop_id", shop.id)
      .eq("user_id", req.user!.id)
      .order("name");
    if (error) {
      return res.status(500).json({
        success: false,
        message: "Unable to load inventory",
      });
    }
    return res.json({
      success: true,
      products: data ?? [],
    });
  },
);
router.post(
  "/shops/:shopId/products",
  requireAuth,
  async (req: Request, res: Response) => {
    const { data: shop } = await supabase
      .from("business_shops")
      .select("id")
      .eq("id", req.params.shopId)
      .eq("user_id", req.user!.id)
      .maybeSingle();
    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }
    const name = String(req.body?.name ?? "").trim();
    const sku = String(req.body?.sku ?? "")
      .trim()
      .toUpperCase();
    const quantity = money(req.body?.quantity);
    const price = money(req.body?.selling_price);
    const cost = money(req.body?.cost_price);
    if (!name || name.length > 160 || !sku) {
      return res.status(400).json({
        success: false,
        message: "Product name and SKU are required",
      });
    }
    const { data, error } = await supabase
      .from("inventory_products")
      .insert({
        id: id(),
        user_id: req.user!.id,
        shop_id: shop.id,
        name,
        sku,
        quantity,
        selling_price: price,
        cost_price: cost,
        reorder_level: money(req.body?.reorder_level),
        unit: String(req.body?.unit ?? "piece").slice(0, 30),
      })
      .select()
      .single();
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    return res.status(201).json({
      success: true,
      product: data,
    });
  },
);
router.patch(
  "/products/:productId",
  requireAuth,
  async (req: Request, res: Response) => {
    const allowed: Record<string, unknown> = {
      name: req.body?.name,
      sku: req.body?.sku,
      quantity: req.body?.quantity,
      selling_price: req.body?.selling_price,
      cost_price: req.body?.cost_price,
      reorder_level: req.body?.reorder_level,
      unit: req.body?.unit,
    };
    Object.keys(allowed).forEach((key) => {
      if (allowed[key] === undefined) {
        delete allowed[key];
      }
    });
    for (const key of [
      "quantity",
      "selling_price",
      "cost_price",
      "reorder_level",
    ]) {
      if (key in allowed) {
        allowed[key] = money(allowed[key]);
      }
    }
    const { data, error } = await supabase
      .from("inventory_products")
      .update(allowed)
      .eq("id", req.params.productId)
      .eq("user_id", req.user!.id)
      .select()
      .maybeSingle();
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }
    return res.json({
      success: true,
      product: data,
    });
  },
);
router.post(
  "/products/:productId/stock",
  requireAuth,
  async (req: Request, res: Response) => {
    const change = Number(req.body?.change);
    if (!Number.isInteger(change) || change === 0) {
      return res.status(400).json({
        success: false,
        message: "Stock change must be a non-zero whole number",
      });
    }
    const { data: product } = await supabase
      .from("inventory_products")
      .select("id,quantity")
      .eq("id", req.params.productId)
      .eq("user_id", req.user!.id)
      .maybeSingle();
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }
    const next = Number(product.quantity) + change;
    if (next < 0) {
      return res.status(400).json({
        success: false,
        message: "Insufficient stock",
      });
    }
    const { data, error } = await supabase
      .from("inventory_products")
      .update({
        quantity: next,
      })
      .eq("id", product.id)
      .eq("user_id", req.user!.id)
      .select()
      .single();
    if (error) {
      return res.status(500).json({
        success: false,
        message: "Unable to update stock",
      });
    }
    await supabase
      .from("inventory_stock_movements")
      .insert({
        id: id(),
        product_id: product.id,
        user_id: req.user!.id,
        change,
        reason: String(
          req.body?.reason ?? "manual adjustment",
        ).slice(0, 200),
      });
    return res.json({
      success: true,
      product: data,
    });
  },
);
/* =========================================================
   INVOICES
   ========================================================= */
router.post(
  "/invoices",
  requireAuth,
  async (req: Request, res: Response) => {
    const client = String(
      req.body?.client_name ?? "",
    ).trim();
    const items: unknown[] = Array.isArray(req.body?.items)
      ? req.body.items
      : [];
    if (!client || !items.length) {
      return res.status(400).json({
        success: false,
        message: "Client and at least one item are required",
      });
    }
    const clean: InvoiceItem[] = items
      .slice(0, 100)
      .map((item: unknown): InvoiceItem => {
        const x = item as Record<string, unknown>;
        return {
          description: String(
            x.description ?? "",
          )
            .trim()
            .slice(0, 200),
          quantity: money(x.quantity),
          unit_price: money(x.unit_price),
        };
      })
      .filter(
        (x: InvoiceItem): boolean =>
          x.description.length > 0 &&
          x.quantity > 0,
      );
    if (!clean.length) {
      return res.status(400).json({
        success: false,
        message: "Invoice items are invalid",
      });
    }
    const subtotal = clean.reduce(
      (
        sum: number,
        item: InvoiceItem,
      ): number =>
        sum + item.quantity * item.unit_price,
      0,
    );
    const tax = money(req.body?.tax);
    const discount = money(req.body?.discount);
    const total = Math.max(
      0,
      subtotal + tax - discount,
    );
    const number = `INV-${new Date().getFullYear()}-${crypto
      .randomBytes(4)
      .toString("hex")
      .toUpperCase()}`;
    const { data: invoice, error } = await supabase
      .from("business_invoices")
      .insert({
        id: id(),
        user_id: req.user!.id,
        invoice_number: number,
        client_name: client,
        client_email: String(
          req.body?.client_email ?? "",
        )
          .trim()
          .slice(0, 255),
        client_phone: String(
          req.body?.client_phone ?? "",
        )
          .trim()
          .slice(0, 40),
        items: clean,
        subtotal,
        tax,
        discount,
        total,
        status: "draft",
        due_date:
          req.body?.due_date || null,
        notes: String(
          req.body?.notes ?? "",
        ).slice(0, 2000),
      })
      .select()
      .single();
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    return res.status(201).json({
      success: true,
      invoice,
    });
  },
);
router.get(
  "/invoices",
  requireAuth,
  async (req: Request, res: Response) => {
    const { data, error } = await supabase
      .from("business_invoices")
      .select("*")
      .eq("user_id", req.user!.id)
      .order("created_at", {
        ascending: false,
      });
    if (error) {
      return res.status(500).json({
        success: false,
        message: "Unable to load invoices",
      });
    }
    return res.json({
      success: true,
      invoices: data ?? [],
    });
  },
);
router.patch(
  "/invoices/:invoiceId",
  requireAuth,
  async (req: Request, res: Response) => {
    const status = String(
      req.body?.status ?? "",
    );
    const validStatuses = [
      "draft",
      "sent",
      "paid",
      "overdue",
      "cancelled",
    ];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid invoice status",
      });
    }
    const { data, error } = await supabase
      .from("business_invoices")
      .update({
        status,
      })
      .eq("id", req.params.invoiceId)
      .eq("user_id", req.user!.id)
      .select()
      .maybeSingle();
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }
    return res.json({
      success: true,
      invoice: data,
    });
  },
);
/* =========================================================
   LANDLORD
   ========================================================= */
router.post(
  "/properties",
  requireAuth,
  async (req: Request, res: Response) => {
    const name = String(
      req.body?.name ?? "",
    ).trim();
    const rent = money(
      req.body?.rent_amount,
    );
    if (!name || rent <= 0) {
      return res.status(400).json({
        success: false,
        message:
          "Property name and rent are required",
      });
    }
    const { data, error } = await supabase
      .from("landlord_properties")
      .insert({
        id: id(),
        user_id: req.user!.id,
        name,
        address: String(
          req.body?.address ?? "",
        ).trim(),
        rent_amount: rent,
        rent_cycle:
          req.body?.rent_cycle ||
          "monthly",
        notes: String(
          req.body?.notes ?? "",
        ).slice(0, 2000),
      })
      .select()
      .single();
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    return res.status(201).json({
      success: true,
      property: data,
    });
  },
);
router.get(
  "/properties",
  requireAuth,
  async (req: Request, res: Response) => {
    const { data, error } = await supabase
      .from("landlord_properties")
      .select("*,landlord_tenants(*)")
      .eq("user_id", req.user!.id)
      .order("created_at", {
        ascending: false,
      });
    if (error) {
      return res.status(500).json({
        success: false,
        message: "Unable to load properties",
      });
    }
    return res.json({
      success: true,
      properties: data ?? [],
    });
  },
);
router.post(
  "/properties/:propertyId/tenants",
  requireAuth,
  async (req: Request, res: Response) => {
    const { data: property } = await supabase
      .from("landlord_properties")
      .select("id")
      .eq("id", req.params.propertyId)
      .eq("user_id", req.user!.id)
      .maybeSingle();
    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }
    const name = String(
      req.body?.name ?? "",
    ).trim();
    const phone = String(
      req.body?.phone ?? "",
    ).trim();
    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Tenant name is required",
      });
    }
    const dueDay = Math.min(
      31,
      Math.max(
        1,
        Number(req.body?.due_day) || 1,
      ),
    );
    const { data, error } = await supabase
      .from("landlord_tenants")
      .insert({
        id: id(),
        user_id: req.user!.id,
        property_id: property.id,
        name,
        phone,
        email: String(
          req.body?.email ?? "",
        ).trim(),
        unit: String(
          req.body?.unit ?? "",
        ).trim(),
        rent_amount: money(
          req.body?.rent_amount,
        ),
        due_day: dueDay,
        utility_amount: money(
          req.body?.utility_amount,
        ),
        status: "active",
      })
      .select()
      .single();
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    return res.status(201).json({
      success: true,
      tenant: data,
    });
  },
);
router.post(
  "/tenants/:tenantId/payment",
  requireAuth,
  async (req: Request, res: Response) => {
    const amount = money(
      req.body?.amount,
    );
    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Payment amount is required",
      });
    }
    const { data: tenant } = await supabase
      .from("landlord_tenants")
      .select("id")
      .eq("id", req.params.tenantId)
      .eq("user_id", req.user!.id)
      .maybeSingle();
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: "Tenant not found",
      });
    }
    const { data, error } = await supabase
      .from("landlord_payments")
      .insert({
        id: id(),
        user_id: req.user!.id,
        tenant_id: tenant.id,
        amount,
        payment_type:
          req.body?.payment_type ||
          "rent",
        paid_at:
          req.body?.paid_at ||
          new Date().toISOString(),
        reference: String(
          req.body?.reference ?? "",
        ).slice(0, 120),
        notes: String(
          req.body?.notes ?? "",
        ).slice(0, 500),
      })
      .select()
      .single();
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    return res.status(201).json({
      success: true,
      payment: data,
    });
  },
);
/* =========================================================
   CHURCH
   ========================================================= */
router.post(
  "/church/offerings",
  requireAuth,
  async (req: Request, res: Response) => {
    const church = String(
      req.body?.church_name ?? "",
    ).trim();
    const rows: unknown[] =
      Array.isArray(req.body?.entries)
        ? req.body.entries
        : [];
    if (!church || !rows.length) {
      return res.status(400).json({
        success: false,
        message:
          "Church and offering entries are required",
      });
    }
    const entries: ChurchOfferingEntry[] =
      rows
        .slice(0, 500)
        .map(
          (
            entry: unknown,
          ): ChurchOfferingEntry => {
            const x =
              entry as Record<
                string,
                unknown
              >;
            return {
              category: String(
                x.category ??
                  "offering",
              ).slice(0, 80),
              amount: money(
                x.amount,
              ),
              method: String(
                x.method ?? "cash",
              ).slice(0, 40),
              note: String(
                x.note ?? "",
              ).slice(0, 300),
            };
          },
        )
        .filter(
          (
            x: ChurchOfferingEntry,
          ): boolean => x.amount > 0,
        );
    const total = entries.reduce(
      (
        sum: number,
        entry: ChurchOfferingEntry,
      ): number =>
        sum + entry.amount,
      0,
    );
    const { data, error } = await supabase
      .from("church_offerings")
      .insert({
        id: id(),
        user_id: req.user!.id,
        church_name: church,
        offering_date:
          req.body?.offering_date ||
          new Date()
            .toISOString()
            .slice(0, 10),
        entries,
        total_amount: total,
        notes: String(
          req.body?.notes ?? "",
        ).slice(0, 1000),
      })
      .select()
      .single();
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    return res.status(201).json({
      success: true,
      offering: data,
    });
  },
);
router.get(
  "/church/offerings",
  requireAuth,
  async (req: Request, res: Response) => {
    const { data, error } = await supabase
      .from("church_offerings")
      .select("*")
      .eq("user_id", req.user!.id)
      .order("offering_date", {
        ascending: false,
      });
    if (error) {
      return res.status(500).json({
        success: false,
        message: "Unable to load offerings",
      });
    }
    return res.json({
      success: true,
      offerings: data ?? [],
    });
  },
);
/* =========================================================
   FUNERAL CONTRIBUTION
   ========================================================= */
router.post(
  "/funerals",
  requireAuth,
  async (req: Request, res: Response) => {
    const title = String(
      req.body?.title ?? "",
    ).trim();
    if (!title || title.length > 180) {
      return res.status(400).json({
        success: false,
        message: "Campaign title is required",
      });
    }
    const base =
      slug(title) ||
      `memorial-${Date.now()}`;
    let publicSlug = base;
    for (let i = 0; i < 5; i += 1) {
      const { data } = await supabase
        .from("funeral_campaigns")
        .select("id")
        .eq("slug", publicSlug)
        .maybeSingle();
      if (!data) {
        break;
      }
      publicSlug = `${base}-${crypto
        .randomBytes(2)
        .toString("hex")}`;
    }
    const { data, error } = await supabase
      .from("funeral_campaigns")
      .insert({
        id: id(),
        user_id: req.user!.id,
        title,
        slug: publicSlug,
        story: String(
          req.body?.story ?? "",
        ).slice(0, 10000),
        target_amount: money(
          req.body?.target_amount,
        ),
        currency: "GHS",
        status: "active",
        beneficiary_name: String(
          req.body?.beneficiary_name ?? "",
        )
          .trim()
          .slice(0, 160),
        beneficiary_phone: String(
          req.body?.beneficiary_phone ?? "",
        )
          .trim()
          .slice(0, 40),
      })
      .select()
      .single();
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    return res.status(201).json({
      success: true,
      campaign: data,
      public_url:
        `/contribute.html?campaign=${encodeURIComponent(
          publicSlug,
        )}`,
    });
  },
);
router.get(
  "/funerals",
  requireAuth,
  async (req: Request, res: Response) => {
    const { data, error } = await supabase
      .from("funeral_campaigns")
      .select("*")
      .eq("user_id", req.user!.id)
      .order("created_at", {
        ascending: false,
      });
    if (error) {
      return res.status(500).json({
        success: false,
        message:
          "Unable to load contribution campaigns",
      });
    }
    return res.json({
      success: true,
      campaigns: data ?? [],
    });
  },
);
router.get(
  "/funerals/public/:slug",
  async (req: Request, res: Response) => {
    const { data, error } = await supabase
      .from("funeral_campaigns")
      .select(
        "id,title,slug,story,target_amount,amount_raised,currency,status,beneficiary_name,created_at",
      )
      .eq("slug", req.params.slug)
      .eq("status", "active")
      .maybeSingle();
    if (error) {
      return res.status(500).json({
        success: false,
        message: "Unable to load campaign",
      });
    }
    if (!data) {
      return res.status(404).json({
        success: false,
        message:
          "Contribution campaign not found",
      });
    }
    return res.json({
      success: true,
      campaign: data,
    });
  },
);
router.post(
  "/funerals/public/:slug/contributions",
  async (req: Request, res: Response) => {
    const name = String(
      req.body?.name ?? "",
    ).trim();
    const amount = money(
      req.body?.amount,
    );
    if (!name || amount < 1) {
      return res.status(400).json({
        success: false,
        message:
          "Name and contribution amount are required",
      });
    }
    const { data: campaign } = await supabase
      .from("funeral_campaigns")
      .select(
        "id,title,user_id,status",
      )
      .eq("slug", req.params.slug)
      .eq("status", "active")
      .maybeSingle();
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message:
          "Contribution campaign not found",
      });
    }
    const reference = `VSBIL-FUN-${Date.now()}-${crypto
      .randomBytes(4)
      .toString("hex")
      .toUpperCase()}`;
    const { data: row, error } =
      await supabase
        .from("funeral_contributions")
        .insert({
          id: id(),
          campaign_id: campaign.id,
          donor_name: name,
          donor_phone: String(
            req.body?.phone ?? "",
          )
            .trim()
            .slice(0, 40),
          amount,
          status: "pending",
          reference,
          anonymous: Boolean(
            req.body?.anonymous,
          ),
        })
        .select()
        .single();
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    return res.status(201).json({
      success: true,
      contribution: row,
      reference,
      message:
        "Contribution created. Payment must be verified server-side before it is counted.",
    });
  },
);
/* =========================================================
   PAYSTACK
   ========================================================= */
router.post(
  "/paystack/initialize",
  requireIdentity,
  async (req: Request, res: Response) => {
    const purpose = String(
      req.body?.purpose ?? "",
    );
    const allowed = [
      "inventory_subscription",
      "invoice_subscription",
      "landlord_subscription",
      "church_subscription",
      "whatsapp_subscription",
    ];
    if (!allowed.includes(purpose)) {
      return res.status(400).json({
        success: false,
        message: "Unsupported subscription",
      });
    }
    const plans: Record<
      string,
      {
        amount: number;
        days: number;
      }
    > = {
      inventory_subscription: {
        amount: 15000,
        days: 30,
      },
      invoice_subscription: {
        amount: 10000,
        days: 30,
      },
      landlord_subscription: {
        amount: 20000,
        days: 365,
      },
      church_subscription: {
        amount: 30000,
        days: 365,
      },
      whatsapp_subscription: {
        amount: 15000,
        days: 30,
      },
    };
    const plan = plans[purpose];
    const secret =
      process.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      return res.status(503).json({
        success: false,
        message:
          "Payment service is not configured",
      });
    }
    const reference = `VSBIL-BIZ-${Date.now()}-${crypto
      .randomBytes(5)
      .toString("hex")
      .toUpperCase()}`;
    const { error } = await supabase
      .from(
        "business_subscription_payments",
      )
      .insert({
        id: id(),
        user_id: req.user!.id,
        purpose,
        amount: plan.amount / 100,
        currency: "GHS",
        reference,
        status: "pending",
      });
    if (error) {
      return res.status(500).json({
        success: false,
        message:
          "Unable to create payment",
      });
    }
    try {
      const response = await fetch(
        "https://api.paystack.co/transaction/initialize",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            email: req.user!.email,
            amount: plan.amount,
            currency: "GHS",
            reference,
            callback_url:
              `${process.env.APP_URL}/business.html`,
            metadata: {
              user_id: req.user!.id,
              purpose,
              days: plan.days,
            },
          }),
        },
      );
      const payload: unknown =
        await response
          .json()
          .catch(() => null);
      const paymentResponse =
        payload as {
          status?: boolean;
          data?: {
            authorization_url?: string;
          };
        } | null;
      if (
        !response.ok ||
        !paymentResponse?.status ||
        !paymentResponse.data
          ?.authorization_url
      ) {
        return res.status(502).json({
          success: false,
          message:
            "Unable to initialize payment",
        });
      }
      return res.json({
        success: true,
        authorization_url:
          paymentResponse.data
            .authorization_url,
        reference,
      });
    } catch (error) {
      console.error(
        "Paystack initialization error:",
        error,
      );
      return res.status(502).json({
        success: false,
        message:
          "Unable to connect to payment service",
      });
    }
  },
);
export default router;