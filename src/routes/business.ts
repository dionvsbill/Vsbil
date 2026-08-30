import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { supabase } from "../config/supabase.js";
import {
  requireAuth,
  requireIdentity,
} from "../middleware/authMiddleware.js";
const router = Router();
/* =========================================================
   TYPES
   ========================================================= */
type InvoiceItem = {
  description: string;
  quantity: number;
  unit_price: number;
};
type OfferingEntry = {
  category: string;
  amount: number;
  method: string;
  note: string;
};
type SubscriptionPlan = {
  amount: number;
  days: number;
};
/* =========================================================
   HELPERS
   ========================================================= */
const money = (value: unknown): number => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }
  return Math.round(number * 100) / 100;
};
const positiveMoney = (value: unknown): number => {
  const amount = money(value);
  return amount > 0 ? amount : 0;
};
const text = (
  value: unknown,
  maxLength = 255,
): string => {
  return String(value ?? "")
    .trim()
    .slice(0, maxLength);
};
const slug = (value: unknown): string => {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 70);
};
const createId = (): string => {
  return crypto.randomUUID();
};
const createReference = (
  prefix: string,
): string => {
  return `${prefix}-${Date.now()}-${crypto
    .randomBytes(5)
    .toString("hex")
    .toUpperCase()}`;
};
const isValidDate = (value: unknown): boolean => {
  if (!value) {
    return true;
  }
  const date = new Date(String(value));
  return !Number.isNaN(date.getTime());
};
const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};
/* =========================================================
   BUSINESS SUITE
   Inventory • Invoices • Landlord • Church • Funeral
   Security principles:
   - Every private read/write is authenticated.
   - Every tenant-owned query is scoped by user_id.
   - Client supplied totals are recalculated server-side.
   - Payment records are created as pending until verified.
   - Secrets are never returned to clients.
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
          .select(
            "id,name,currency,created_at",
          )
          .eq("user_id", uid)
          .order("created_at", {
            ascending: false,
          })
          .limit(10),
        supabase
          .from("business_invoices")
          .select(
            "id,invoice_number,client_name,total,status,due_date,created_at",
          )
          .eq("user_id", uid)
          .order("created_at", {
            ascending: false,
          })
          .limit(10),
        supabase
          .from("landlord_properties")
          .select(
            "id,name,address,rent_amount,rent_cycle,created_at",
          )
          .eq("user_id", uid)
          .order("created_at", {
            ascending: false,
          })
          .limit(10),
        supabase
          .from("church_offerings")
          .select(
            "id,church_name,offering_date,total_amount,created_at",
          )
          .eq("user_id", uid)
          .order("offering_date", {
            ascending: false,
          })
          .limit(10),
        supabase
          .from("funeral_campaigns")
          .select(
            "id,title,slug,target_amount,amount_raised,status,created_at",
          )
          .eq("user_id", uid)
          .order("created_at", {
            ascending: false,
          })
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
          result,
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
      console.error(
        "Business overview error:",
        error,
      );
      return res.status(500).json({
        success: false,
        message:
          "Unable to load business suite",
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
    const name = text(req.body?.name, 120);
    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Shop name is required",
      });
    }
    const phone = text(
      req.body?.phone,
      40,
    );
    const address = text(
      req.body?.address,
      500,
    );
    try {
      const { data, error } =
        await supabase
          .from("business_shops")
          .insert({
            id: createId(),
            user_id: req.user!.id,
            name,
            phone,
            address,
            currency: "GHS",
          })
          .select()
          .single();
      if (error) {
        console.error(
          "Create shop:",
          error,
        );
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }
      return res.status(201).json({
        success: true,
        shop: data,
      });
    } catch (error) {
      console.error(
        "Create shop exception:",
        error,
      );
      return res.status(500).json({
        success: false,
        message: "Unable to create shop",
      });
    }
  },
);
router.get(
  "/shops/:shopId/products",
  requireAuth,
  async (req: Request, res: Response) => {
    const shopId = text(
      req.params.shopId,
      100,
    );
    try {
      const { data: shop, error: shopError } =
        await supabase
          .from("business_shops")
          .select("id")
          .eq("id", shopId)
          .eq("user_id", req.user!.id)
          .maybeSingle();
      if (shopError) {
        return res.status(500).json({
          success: false,
          message:
            "Unable to verify shop",
        });
      }
      if (!shop) {
        return res.status(404).json({
          success: false,
          message: "Shop not found",
        });
      }
      const {
        data,
        error,
      } = await supabase
        .from("inventory_products")
        .select("*")
        .eq("shop_id", shop.id)
        .eq("user_id", req.user!.id)
        .order("name");
      if (error) {
        return res.status(500).json({
          success: false,
          message:
            "Unable to load inventory",
        });
      }
      return res.json({
        success: true,
        products: data ?? [],
      });
    } catch (error) {
      console.error(
        "Load inventory:",
        error,
      );
      return res.status(500).json({
        success: false,
        message:
          "Unable to load inventory",
      });
    }
  },
);
router.post(
  "/shops/:shopId/products",
  requireAuth,
  async (req: Request, res: Response) => {
    const shopId = text(
      req.params.shopId,
      100,
    );
    const name = text(
      req.body?.name,
      160,
    );
    const sku = text(
      req.body?.sku,
      80,
    ).toUpperCase();
    const quantity = money(
      req.body?.quantity,
    );
    const sellingPrice = money(
      req.body?.selling_price,
    );
    const costPrice = money(
      req.body?.cost_price,
    );
    const reorderLevel = money(
      req.body?.reorder_level,
    );
    const unit = text(
      req.body?.unit ?? "piece",
      30,
    );
    if (!name || !sku) {
      return res.status(400).json({
        success: false,
        message:
          "Product name and SKU are required",
      });
    }
    try {
      const {
        data: shop,
        error: shopError,
      } = await supabase
        .from("business_shops")
        .select("id")
        .eq("id", shopId)
        .eq("user_id", req.user!.id)
        .maybeSingle();
      if (shopError) {
        return res.status(500).json({
          success: false,
          message:
            "Unable to verify shop",
        });
      }
      if (!shop) {
        return res.status(404).json({
          success: false,
          message: "Shop not found",
        });
      }
      const {
        data,
        error,
      } = await supabase
        .from("inventory_products")
        .insert({
          id: createId(),
          user_id: req.user!.id,
          shop_id: shop.id,
          name,
          sku,
          quantity,
          selling_price: sellingPrice,
          cost_price: costPrice,
          reorder_level: reorderLevel,
          unit,
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
    } catch (error) {
      console.error(
        "Create inventory product:",
        error,
      );
      return res.status(500).json({
        success: false,
        message:
          "Unable to create product",
      });
    }
  },
);
router.patch(
  "/products/:productId",
  requireAuth,
  async (req: Request, res: Response) => {
    const allowed: Record<
      string,
      unknown
    > = {};
    const fields = [
      "name",
      "sku",
      "quantity",
      "selling_price",
      "cost_price",
      "reorder_level",
      "unit",
    ] as const;
    for (const field of fields) {
      if (
        req.body?.[field] !==
        undefined
      ) {
        allowed[field] =
          req.body[field];
      }
    }
    if (
      typeof allowed.name ===
        "string"
    ) {
      allowed.name = text(
        allowed.name,
        160,
      );
    }
    if (
      typeof allowed.sku ===
        "string"
    ) {
      allowed.sku = text(
        allowed.sku,
        80,
      ).toUpperCase();
    }
    if (
      typeof allowed.unit ===
        "string"
    ) {
      allowed.unit = text(
        allowed.unit,
        30,
      );
    }
    for (const field of [
      "quantity",
      "selling_price",
      "cost_price",
      "reorder_level",
    ]) {
      if (
        field in allowed
      ) {
        allowed[field] =
          money(
            allowed[field],
          );
      }
    }
    if (
      Object.keys(allowed)
        .length === 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "No valid fields supplied",
      });
    }
    try {
      const {
        data,
        error,
      } = await supabase
        .from("inventory_products")
        .update(allowed)
        .eq(
          "id",
          req.params.productId,
        )
        .eq(
          "user_id",
          req.user!.id,
        )
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
          message:
            "Product not found",
        });
      }
      return res.json({
        success: true,
        product: data,
      });
    } catch (error) {
      console.error(
        "Update product:",
        error,
      );
      return res.status(500).json({
        success: false,
        message:
          "Unable to update product",
      });
    }
  },
);
router.post(
  "/products/:productId/stock",
  requireAuth,
  async (req: Request, res: Response) => {
    const change = Number(
      req.body?.change,
    );
    if (
      !Number.isInteger(change) ||
      change === 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Stock change must be a non-zero whole number",
      });
    }
    try {
      const {
        data: product,
        error: productError,
      } = await supabase
        .from("inventory_products")
        .select(
          "id,quantity",
        )
        .eq(
          "id",
          req.params.productId,
        )
        .eq(
          "user_id",
          req.user!.id,
        )
        .maybeSingle();
      if (productError) {
        return res.status(500).json({
          success: false,
          message:
            "Unable to load product",
        });
      }
      if (!product) {
        return res.status(404).json({
          success: false,
          message:
            "Product not found",
        });
      }
      const currentQuantity =
        Number(
          product.quantity,
        );
      const nextQuantity =
        currentQuantity + change;
      if (nextQuantity < 0) {
        return res.status(400).json({
          success: false,
          message:
            "Insufficient stock",
        });
      }
      const {
        data,
        error,
      } = await supabase
        .from("inventory_products")
        .update({
          quantity:
            nextQuantity,
        })
        .eq(
          "id",
          product.id,
        )
        .eq(
          "user_id",
          req.user!.id,
        )
        .select()
        .single();
      if (error) {
        return res.status(500).json({
          success: false,
          message:
            "Unable to update stock",
        });
      }
      const {
        error:
          movementError,
      } = await supabase
        .from(
          "inventory_stock_movements",
        )
        .insert({
          id: createId(),
          product_id:
            product.id,
          user_id:
            req.user!.id,
          change,
          reason: text(
            req.body?.reason ??
              "manual adjustment",
            200,
          ),
        });
      if (movementError) {
        console.error(
          "Stock movement logging failed:",
          movementError,
        );
      }
      return res.json({
        success: true,
        product: data,
      });
    } catch (error) {
      console.error(
        "Stock update:",
        error,
      );
      return res.status(500).json({
        success: false,
        message:
          "Unable to update stock",
      });
    }
  },
);
/* =========================================================
   INVOICES
   ========================================================= */
router.post(
  "/invoices",
  requireAuth,
  async (req: Request, res: Response) => {
    const client = text(
      req.body?.client_name,
      160,
    );
    const rawItems: unknown[] =
      Array.isArray(
        req.body?.items,
      )
        ? req.body.items
        : [];
    if (
      !client ||
      rawItems.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Client and at least one item are required",
      });
    }
    const clean: InvoiceItem[] =
      rawItems
        .slice(0, 100)
        .map(
          (
            item: unknown,
          ): InvoiceItem => {
            const value =
              item !== null &&
              typeof item ===
                "object"
                ? item as Record<
                    string,
                    unknown
                  >
                : {};
            return {
              description:
                text(
                  value.description,
                  200,
                ),
              quantity:
                money(
                  value.quantity,
                ),
              unit_price:
                money(
                  value.unit_price,
                ),
            };
          },
        )
        .filter(
          (
            item: InvoiceItem,
          ) =>
            item.description.length >
              0 &&
            item.quantity > 0,
        );
    if (clean.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "Invoice items are invalid",
      });
    }
    const subtotal =
      clean.reduce(
        (
          sum: number,
          item: InvoiceItem,
        ) =>
          sum +
          item.quantity *
            item.unit_price,
        0,
      );
    const tax = money(
      req.body?.tax,
    );
    const discount = money(
      req.body?.discount,
    );
    const total = Math.max(
      0,
      subtotal +
        tax -
        discount,
    );
    const dueDate =
      req.body?.due_date
        ? String(
            req.body.due_date,
          ).trim()
        : null;
    if (
      dueDate &&
      !isValidDate(dueDate)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid due date",
      });
    }
    const invoiceNumber =
      `INV-${new Date().getFullYear()}-${crypto
        .randomBytes(4)
        .toString("hex")
        .toUpperCase()}`;
    try {
      const {
        data: invoice,
        error,
      } = await supabase
        .from(
          "business_invoices",
        )
        .insert({
          id: createId(),
          user_id:
            req.user!.id,
          invoice_number:
            invoiceNumber,
          client_name:
            client,
          client_email:
            text(
              req.body?.client_email,
              255,
            ),
          client_phone:
            text(
              req.body?.client_phone,
              40,
            ),
          items: clean,
          subtotal,
          tax,
          discount,
          total,
          status: "draft",
          due_date:
            dueDate,
          notes: text(
            req.body?.notes,
            2000,
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
        invoice,
      });
    } catch (error) {
      console.error(
        "Create invoice:",
        error,
      );
      return res.status(500).json({
        success: false,
        message:
          "Unable to create invoice",
      });
    }
  },
);
router.get(
  "/invoices",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const {
        data,
        error,
      } = await supabase
        .from(
          "business_invoices",
        )
        .select("*")
        .eq(
          "user_id",
          req.user!.id,
        )
        .order(
          "created_at",
          {
            ascending: false,
          },
        );
      if (error) {
        return res.status(500).json({
          success: false,
          message:
            "Unable to load invoices",
        });
      }
      return res.json({
        success: true,
        invoices: data ?? [],
      });
    } catch (error) {
      console.error(
        "Load invoices:",
        error,
      );
      return res.status(500).json({
        success: false,
        message:
          "Unable to load invoices",
      });
    }
  },
);
router.patch(
  "/invoices/:invoiceId",
  requireAuth,
  async (req: Request, res: Response) => {
    const status = text(
      req.body?.status,
      30,
    );
    const allowedStatuses =
      [
        "draft",
        "sent",
        "paid",
        "overdue",
        "cancelled",
      ] as const;
    if (
      !allowedStatuses.includes(
        status as
          (typeof allowedStatuses)[number],
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid invoice status",
      });
    }
    try {
      const {
        data,
        error,
      } = await supabase
        .from(
          "business_invoices",
        )
        .update({
          status,
        })
        .eq(
          "id",
          req.params.invoiceId,
        )
        .eq(
          "user_id",
          req.user!.id,
        )
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
          message:
            "Invoice not found",
        });
      }
      return res.json({
        success: true,
        invoice: data,
      });
    } catch (error) {
      console.error(
        "Update invoice:",
        error,
      );
      return res.status(500).json({
        success: false,
        message:
          "Unable to update invoice",
      });
    }
  },
);
/* =========================================================
   LANDLORD
   ========================================================= */
router.post(
  "/properties",
  requireAuth,
  async (req: Request, res: Response) => {
    const name = text(
      req.body?.name,
      160,
    );
    const rent = positiveMoney(
      req.body?.rent_amount,
    );
    if (
      !name ||
      rent <= 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Property name and rent are required",
      });
    }
    const rentCycle = text(
      req.body?.rent_cycle ??
        "monthly",
      30,
    );
    try {
      const {
        data,
        error,
      } = await supabase
        .from(
          "landlord_properties",
        )
        .insert({
          id: createId(),
          user_id:
            req.user!.id,
          name,
          address: text(
            req.body?.address,
            500,
          ),
          rent_amount:
            rent,
          rent_cycle:
            rentCycle ||
            "monthly",
          notes: text(
            req.body?.notes,
            2000,
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
        property: data,
      });
    } catch (error) {
      console.error(
        "Create property:",
        error,
      );
      return res.status(500).json({
        success: false,
        message:
          "Unable to create property",
      });
    }
  },
);
router.get(
  "/properties",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const {
        data,
        error,
      } = await supabase
        .from(
          "landlord_properties",
        )
        .select(
          "*,landlord_tenants(*)",
        )
        .eq(
          "user_id",
          req.user!.id,
        )
        .order(
          "created_at",
          {
            ascending: false,
          },
        );
      if (error) {
        return res.status(500).json({
          success: false,
          message:
            "Unable to load properties",
        });
      }
      return res.json({
        success: true,
        properties: data ?? [],
      });
    } catch (error) {
      console.error(
        "Load properties:",
        error,
      );
      return res.status(500).json({
        success: false,
        message:
          "Unable to load properties",
      });
    }
  },
);
router.post(
  "/properties/:propertyId/tenants",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const {
        data: property,
        error: propertyError,
      } = await supabase
        .from(
          "landlord_properties",
        )
        .select("id")
        .eq(
          "id",
          req.params.propertyId,
        )
        .eq(
          "user_id",
          req.user!.id,
        )
        .maybeSingle();
      if (propertyError) {
        return res.status(500).json({
          success: false,
          message:
            "Unable to verify property",
        });
      }
      if (!property) {
        return res.status(404).json({
          success: false,
          message:
            "Property not found",
        });
      }
      const name = text(
        req.body?.name,
        160,
      );
      const phone = text(
        req.body?.phone,
        40,
      );
      if (!name) {
        return res.status(400).json({
          success: false,
          message:
            "Tenant name is required",
        });
      }
      const dueDayRaw = Number(
        req.body?.due_day,
      );
      const dueDay =
        Number.isInteger(
          dueDayRaw,
        )
          ? Math.min(
              31,
              Math.max(
                1,
                dueDayRaw,
              ),
            )
          : 1;
      const {
        data,
        error,
      } = await supabase
        .from(
          "landlord_tenants",
        )
        .insert({
          id: createId(),
          user_id:
            req.user!.id,
          property_id:
            property.id,
          name,
          phone,
          email: text(
            req.body?.email,
            255,
          ),
          unit: text(
            req.body?.unit,
            100,
          ),
          rent_amount:
            money(
              req.body?.rent_amount,
            ),
          due_day:
            dueDay,
          utility_amount:
            money(
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
    } catch (error) {
      console.error(
        "Create tenant:",
        error,
      );
      return res.status(500).json({
        success: false,
        message:
          "Unable to create tenant",
      });
    }
  },
);
router.post(
  "/tenants/:tenantId/payment",
  requireAuth,
  async (req: Request, res: Response) => {
    const amount = positiveMoney(
      req.body?.amount,
    );
    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message:
          "Payment amount is required",
      });
    }
    try {
      const {
        data: tenant,
        error: tenantError,
      } = await supabase
        .from(
          "landlord_tenants",
        )
        .select("id")
        .eq(
          "id",
          req.params.tenantId,
        )
        .eq(
          "user_id",
          req.user!.id,
        )
        .maybeSingle();
      if (tenantError) {
        return res.status(500).json({
          success: false,
          message:
            "Unable to verify tenant",
        });
      }
      if (!tenant) {
        return res.status(404).json({
          success: false,
          message:
            "Tenant not found",
        });
      }
      const {
        data,
        error,
      } = await supabase
        .from(
          "landlord_payments",
        )
        .insert({
          id: createId(),
          user_id:
            req.user!.id,
          tenant_id:
            tenant.id,
          amount,
          payment_type:
            text(
              req.body
                ?.payment_type ??
                "rent",
              50,
            ),
          paid_at:
            req.body?.paid_at ||
            new Date().toISOString(),
          reference:
            text(
              req.body?.reference,
              120,
            ),
          notes: text(
            req.body?.notes,
            500,
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
        payment: data,
      });
    } catch (error) {
      console.error(
        "Create tenant payment:",
        error,
      );
      return res.status(500).json({
        success: false,
        message:
          "Unable to record payment",
      });
    }
  },
);
/* =========================================================
   CHURCH OFFERINGS
   ========================================================= */
router.post(
  "/church/offerings",
  requireAuth,
  async (req: Request, res: Response) => {
    const church = text(
      req.body?.church_name,
      180,
    );
    const rawRows: unknown[] =
      Array.isArray(
        req.body?.entries,
      )
        ? req.body.entries
        : [];
    if (
      !church ||
      rawRows.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Church and offering entries are required",
      });
    }
    const entries: OfferingEntry[] =
      rawRows
        .slice(0, 500)
        .map(
          (
            row: unknown,
          ): OfferingEntry => {
            const value =
              row !== null &&
              typeof row ===
                "object"
                ? row as Record<
                    string,
                    unknown
                  >
                : {};
            return {
              category: text(
                value.category ??
                  "offering",
                80,
              ),
              amount: money(
                value.amount,
              ),
              method: text(
                value.method ??
                  "cash",
                40,
              ),
              note: text(
                value.note,
                300,
              ),
            };
          },
        )
        .filter(
          (
            entry: OfferingEntry,
          ) =>
            entry.amount > 0,
        );
    if (
      entries.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Offering entries are invalid",
      });
    }
    const total =
      entries.reduce(
        (
          sum: number,
          entry: OfferingEntry,
        ) =>
          sum +
          entry.amount,
        0,
      );
    const offeringDate =
      req.body?.offering_date
        ? String(
            req.body.offering_date,
          ).trim()
        : new Date()
            .toISOString()
            .slice(0, 10);
    try {
      const {
        data,
        error,
      } = await supabase
        .from(
          "church_offerings",
        )
        .insert({
          id: createId(),
          user_id:
            req.user!.id,
          church_name:
            church,
          offering_date:
            offeringDate,
          entries,
          total_amount:
            total,
          notes: text(
            req.body?.notes,
            1000,
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
        offering: data,
      });
    } catch (error) {
      console.error(
        "Create church offering:",
        error,
      );
      return res.status(500).json({
        success: false,
        message:
          "Unable to create offering",
      });
    }
  },
);
router.get(
  "/church/offerings",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const {
        data,
        error,
      } = await supabase
        .from(
          "church_offerings",
        )
        .select("*")
        .eq(
          "user_id",
          req.user!.id,
        )
        .order(
          "offering_date",
          {
            ascending: false,
          },
        );
      if (error) {
        return res.status(500).json({
          success: false,
          message:
            "Unable to load offerings",
        });
      }
      return res.json({
        success: true,
        offerings: data ?? [],
      });
    } catch (error) {
      console.error(
        "Load offerings:",
        error,
      );
      return res.status(500).json({
        success: false,
        message:
          "Unable to load offerings",
      });
    }
  },
);
/* =========================================================
   FUNERAL CONTRIBUTION
   ========================================================= */
router.post(
  "/funerals",
  requireAuth,
  async (req: Request, res: Response) => {
    const title = text(
      req.body?.title,
      180,
    );
    if (!title) {
      return res.status(400).json({
        success: false,
        message:
          "Campaign title is required",
      });
    }
    const base =
      slug(title) ||
      `memorial-${Date.now()}`;
    let publicSlug = base;
    try {
      let foundUniqueSlug =
        false;
      for (
        let attempt = 0;
        attempt < 5;
        attempt++
      ) {
        const {
          data,
          error,
        } = await supabase
          .from(
            "funeral_campaigns",
          )
          .select("id")
          .eq(
            "slug",
            publicSlug,
          )
          .maybeSingle();
        if (error) {
          throw error;
        }
        if (!data) {
          foundUniqueSlug =
            true;
          break;
        }
        publicSlug =
          `${base}-${crypto
            .randomBytes(2)
            .toString("hex")}`;
      }
      if (!foundUniqueSlug) {
        publicSlug =
          `${base}-${crypto
            .randomBytes(6)
            .toString("hex")}`;
      }
      const {
        data,
        error,
      } = await supabase
        .from(
          "funeral_campaigns",
        )
        .insert({
          id: createId(),
          user_id:
            req.user!.id,
          title,
          slug: publicSlug,
          story: text(
            req.body?.story,
            10000,
          ),
          target_amount:
            money(
              req.body?.target_amount,
            ),
          currency: "GHS",
          status: "active",
          beneficiary_name:
            text(
              req.body
                ?.beneficiary_name,
              160,
            ),
          beneficiary_phone:
            text(
              req.body
                ?.beneficiary_phone,
              40,
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
        campaign: data,
        public_url:
          `/contribute.html?campaign=${encodeURIComponent(
            publicSlug,
          )}`,
      });
    } catch (error) {
      console.error(
        "Create funeral campaign:",
        error,
      );
      return res.status(500).json({
        success: false,
        message:
          "Unable to create contribution campaign",
      });
    }
  },
);
router.get(
  "/funerals",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const {
        data,
        error,
      } = await supabase
        .from(
          "funeral_campaigns",
        )
        .select("*")
        .eq(
          "user_id",
          req.user!.id,
        )
        .order(
          "created_at",
          {
            ascending: false,
          },
        );
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
    } catch (error) {
      console.error(
        "Load funeral campaigns:",
        error,
      );
      return res.status(500).json({
        success: false,
        message:
          "Unable to load contribution campaigns",
      });
    }
  },
);
router.get(
  "/funerals/public/:slug",
  async (req: Request, res: Response) => {
    try {
      const {
        data,
        error,
      } = await supabase
        .from(
          "funeral_campaigns",
        )
        .select(
          "id,title,slug,story,target_amount,amount_raised,currency,status,beneficiary_name,created_at",
        )
        .eq(
          "slug",
          req.params.slug,
        )
        .eq(
          "status",
          "active",
        )
        .maybeSingle();
      if (error) {
        return res.status(500).json({
          success: false,
          message:
            "Unable to load campaign",
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
    } catch (error) {
      console.error(
        "Public funeral campaign:",
        error,
      );
      return res.status(500).json({
        success: false,
        message:
          "Unable to load campaign",
      });
    }
  },
);
router.post(
  "/funerals/public/:slug/contributions",
  async (req: Request, res: Response) => {
    const name = text(
      req.body?.name,
      160,
    );
    const amount =
      positiveMoney(
        req.body?.amount,
      );
    if (
      !name ||
      amount < 1
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Name and contribution amount are required",
      });
    }
    try {
      const {
        data: campaign,
        error: campaignError,
      } = await supabase
        .from(
          "funeral_campaigns",
        )
        .select(
          "id,title,user_id,status",
        )
        .eq(
          "slug",
          req.params.slug,
        )
        .eq(
          "status",
          "active",
        )
        .maybeSingle();
      if (campaignError) {
        return res.status(500).json({
          success: false,
          message:
            "Unable to verify campaign",
        });
      }
      if (!campaign) {
        return res.status(404).json({
          success: false,
          message:
            "Contribution campaign not found",
        });
      }
      const reference =
        createReference(
          "VSBIL-FUN",
        );
      const {
        data: contribution,
        error,
      } = await supabase
        .from(
          "funeral_contributions",
        )
        .insert({
          id: createId(),
          campaign_id:
            campaign.id,
          donor_name:
            name,
          donor_phone:
            text(
              req.body?.phone,
              40,
            ),
          amount,
          status:
            "pending",
          reference,
          anonymous:
            Boolean(
              req.body
                ?.anonymous,
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
        contribution,
        reference,
        message:
          "Contribution created. Payment must be verified server-side before it is counted.",
      });
    } catch (error) {
      console.error(
        "Create funeral contribution:",
        error,
      );
      return res.status(500).json({
        success: false,
        message:
          "Unable to create contribution",
      });
    }
  },
);
/* =========================================================
   PAYSTACK BUSINESS SUBSCRIPTIONS
   ========================================================= */
const subscriptionPlans: Record<
  string,
  SubscriptionPlan
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
router.post(
  "/paystack/initialize",
  requireIdentity,
  async (req: Request, res: Response) => {
    const purpose = text(
      req.body?.purpose,
      80,
    );
    const plan =
      subscriptionPlans[
        purpose
      ];
    if (!plan) {
      return res.status(400).json({
        success: false,
        message:
          "Unsupported subscription",
      });
    }
    const secret =
      process.env
        .PAYSTACK_SECRET_KEY;
    if (!secret) {
      return res.status(503).json({
        success: false,
        message:
          "Payment service is not configured",
      });
    }
    const appUrl =
      process.env.APP_URL;
    if (!appUrl) {
      return res.status(503).json({
        success: false,
        message:
          "Application URL is not configured",
      });
    }
    const reference =
      createReference(
        "VSBIL-BIZ",
      );
    try {
      const {
        error: paymentInsertError,
      } = await supabase
        .from(
          "business_subscription_payments",
        )
        .insert({
          id: createId(),
          user_id:
            req.user!.id,
          purpose,
          amount:
            plan.amount /
            100,
          currency:
            "GHS",
          reference,
          status:
            "pending",
        });
      if (paymentInsertError) {
        console.error(
          "Create subscription payment:",
          paymentInsertError,
        );
        return res.status(500).json({
          success: false,
          message:
            "Unable to create payment",
        });
      }
      const response =
        await fetch(
          "https://api.paystack.co/transaction/initialize",
          {
            method: "POST",
            headers: {
              Authorization:
                `Bearer ${secret}`,
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              email:
                req.user!.email,
              amount:
                plan.amount,
              currency:
                "GHS",
              reference,
              callback_url:
                `${appUrl.replace(
                  /\/$/,
                  "",
                )}/business.html`,
              metadata: {
                user_id:
                  req.user!.id,
                purpose,
                days:
                  plan.days,
              },
            }),
          },
        );
      const result: unknown =
        await response
          .json()
          .catch(
            () => null,
          );
      if (
        !response.ok ||
        result === null ||
        typeof result !==
          "object"
      ) {
        return res.status(502).json({
          success: false,
          message:
            "Unable to initialize payment",
        });
      }
      const paystackResult =
        result as {
          status?: boolean;
          message?: string;
          data?: {
            authorization_url?: string;
          };
        };
      if (
        paystackResult.status !==
          true ||
        !paystackResult.data
          ?.authorization_url
      ) {
        console.error(
          "Paystack initialization failed:",
          paystackResult.message,
        );
        return res.status(502).json({
          success: false,
          message:
            "Unable to initialize payment",
        });
      }
      return res.json({
        success: true,
        authorization_url:
          paystackResult.data
            .authorization_url,
        reference,
      });
    } catch (error) {
      console.error(
        "Paystack initialization:",
        error,
      );
      return res.status(502).json({
        success: false,
        message:
          "Unable to initialize payment",
      });
    }
  },
);
export default router;