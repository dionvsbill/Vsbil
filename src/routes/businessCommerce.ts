import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = Router();

type ShopPlan = "inventory" | "whatsapp";

type ShopItem = {
  product_id: string;
  quantity: number;
};

const clean = (value: unknown, max = 500): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const makeSlug = (value: unknown): string =>
  clean(value, 100)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);

const activeUntil = (row: { status?: string; ends_at?: string | null } | null): boolean =>
  Boolean(
    row?.status === "active" &&
      (!row.ends_at || new Date(row.ends_at).getTime() > Date.now()),
  );

async function hasPlan(userId: string, product: ShopPlan): Promise<boolean> {
  const { data } = await supabase
    .from("business_subscriptions")
    .select("status,ends_at")
    .eq("user_id", userId)
    .eq("product", product)
    .maybeSingle();

  return activeUntil(data);
}

async function uniqueStoreSlug(baseValue: unknown, userId?: string): Promise<string> {
  const base = makeSlug(baseValue) || `shop-${crypto.randomBytes(4).toString("hex")}`;
  let candidate = base;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data } = await supabase
      .from("business_shops")
      .select("id,user_id")
      .eq("store_slug", candidate)
      .maybeSingle();

    if (!data || (userId && data.user_id === userId)) return candidate;
    candidate = `${base}-${crypto.randomBytes(2).toString("hex")}`;
  }

  return `${base}-${Date.now().toString(36)}`.slice(0, 70);
}

/* =========================================================
   REAL VSBIL SHOP / E-COMMERCE API
   The existing commerce database and atomic order RPC remain the
   source of truth. These endpoints only expose the existing system.
   ========================================================= */

/* Create a real shop. Publishing is separate and requires the shop plan. */
router.post(
  "/shops",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const name = clean(req.body?.name, 120);
      if (!name) {
        return res.status(400).json({
          success: false,
          message: "Shop name is required",
        });
      }

      const storeSlug = await uniqueStoreSlug(req.body?.storeSlug || name, req.user!.id);
      const { data, error } = await supabase
        .from("business_shops")
        .insert({
          id: crypto.randomUUID(),
          user_id: req.user!.id,
          name,
          phone: clean(req.body?.phone, 40) || null,
          address: clean(req.body?.address, 500) || null,
          currency: "GHS",
          store_slug: storeSlug,
          description: clean(req.body?.description, 2000) || null,
          logo_url: clean(req.body?.logoUrl, 1000) || null,
          is_published: false,
          whatsapp_auto_reply: true,
        })
        .select(
          "id,name,description,logo_url,phone,address,currency,store_slug,is_published,whatsapp_bot_id,whatsapp_auto_reply,created_at",
        )
        .single();

      if (error) {
        if (error.code === "23505") {
          return res.status(409).json({
            success: false,
            message: "That store URL is already in use",
          });
        }
        return res.status(400).json({ success: false, message: error.message });
      }

      return res.status(201).json({ success: true, shop: data });
    } catch (error) {
      console.error("Create shop", error);
      return res.status(500).json({
        success: false,
        message: "Unable to create shop",
      });
    }
  },
);

/* Owner's real shops, used by profile/business interfaces. */
router.get(
  "/shops/mine",
  requireAuth,
  async (req: Request, res: Response) => {
    const { data, error } = await supabase
      .from("business_shops")
      .select(
        "id,name,description,logo_url,phone,address,currency,store_slug,is_published,whatsapp_bot_id,whatsapp_auto_reply,created_at",
      )
      .eq("user_id", req.user!.id)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Unable to load your shops",
      });
    }

    return res.json({ success: true, shops: data ?? [] });
  },
);

/* Public storefront catalog. Never expose owner IDs or WhatsApp bot IDs. */
router.get(
  "/store/:slug",
  async (req: Request, res: Response) => {
    try {
      const storeSlug = makeSlug(req.params.slug);
      const { data: shop, error: shopError } = await supabase
        .from("business_shops")
        .select(
          "id,name,description,logo_url,phone,address,currency,store_slug,whatsapp_bot_id",
        )
        .eq("store_slug", storeSlug)
        .eq("is_published", true)
        .maybeSingle();

      if (shopError) throw shopError;
      if (!shop) {
        return res.status(404).json({
          success: false,
          message: "Shop not found",
        });
      }

      const { data: products, error } = await supabase
        .from("inventory_products")
        .select(
          "id,name,sku,description,image_url,selling_price,discount_percent,quantity,unit",
        )
        .eq("shop_id", shop.id)
        .eq("is_published", true)
        .order("name");

      if (error) throw error;

      return res.json({
        success: true,
        shop: {
          ...shop,
          whatsapp_bot_id: undefined,
        },
        products: (products ?? []).map((product) => {
          const discount = Math.min(Math.max(Number(product.discount_percent) || 0, 0), 100);
          const salePrice =
            Math.round(Number(product.selling_price) * (1 - discount / 100) * 100) / 100;

          return {
            ...product,
            available: Number(product.quantity) > 0,
            sale_price: salePrice,
          };
        }),
      });
    } catch (error) {
      console.error("Storefront", error);
      return res.status(500).json({
        success: false,
        message: "Unable to load storefront",
      });
    }
  },
);

/* Public order creation is delegated to the existing atomic DB transaction. */
router.post(
  "/store/:slug/orders",
  async (req: Request, res: Response) => {
    try {
      const storeSlug = makeSlug(req.params.slug);
      const { data: shop } = await supabase
        .from("business_shops")
        .select("id,user_id,is_published")
        .eq("store_slug", storeSlug)
        .eq("is_published", true)
        .maybeSingle();

      if (!shop) {
        return res.status(404).json({
          success: false,
          message: "Shop not found",
        });
      }

      const buyerName = clean(req.body?.buyerName, 160);
      const buyerPhone = clean(req.body?.buyerPhone, 40);
      const buyerEmail = clean(req.body?.buyerEmail, 255);
      const address = clean(req.body?.deliveryAddress, 1000);
      const note = clean(req.body?.deliveryNote, 1000);
      const paymentMethod =
        clean(req.body?.paymentMethod, 30) || "cash_on_delivery";

      const items: ShopItem[] = Array.isArray(req.body?.items)
        ? req.body.items
            .slice(0, 50)
            .map((item: unknown): ShopItem => {
              const value = item as Record<string, unknown>;
              return {
                product_id: clean(value.productId, 80),
                quantity: Math.floor(num(value.quantity)),
              };
            })
            .filter((item: ShopItem) => item.product_id && item.quantity > 0)
        : [];

      if (!buyerName || !buyerPhone || !items.length) {
        return res.status(400).json({
          success: false,
          message: "Buyer name, phone and at least one product are required",
        });
      }

      const { data, error } = await supabase.rpc("create_shop_order", {
        p_shop_id: shop.id,
        p_buyer_name: buyerName,
        p_buyer_phone: buyerPhone,
        p_buyer_email: buyerEmail || null,
        p_delivery_address: address || null,
        p_delivery_note: note || null,
        p_payment_method: paymentMethod,
        p_delivery_fee: num(req.body?.deliveryFee),
        p_items: items,
      });

      if (error) {
        const message = String(error.message || "");
        if (message.includes("INSUFFICIENT_STOCK")) {
          return res.status(409).json({
            success: false,
            message: "One or more products no longer have enough stock",
          });
        }
        if (message.includes("SHOP_NOT_AVAILABLE")) {
          return res.status(404).json({
            success: false,
            message: "Shop is not available",
          });
        }
        if (message.includes("INVALID_PAYMENT_METHOD")) {
          return res.status(400).json({
            success: false,
            message: "Invalid payment method",
          });
        }
        return res.status(400).json({
          success: false,
          message: "Unable to create order",
        });
      }

      const order = Array.isArray(data) ? data[0] : data;
      if (!order) {
        return res.status(500).json({
          success: false,
          message: "Order was not created",
        });
      }

      return res.status(201).json({
        success: true,
        order: {
          orderNumber: order.order_number,
          subtotal: Number(order.subtotal),
          discountAmount: Number(order.discount_amount),
          deliveryFee: Number(order.delivery_fee),
          total: Number(order.total),
          status: "pending",
          paymentStatus: "unpaid",
        },
        message: "Order received. Keep your order number to track delivery.",
      });
    } catch (error) {
      console.error("Store order", error);
      return res.status(500).json({
        success: false,
        message: "Unable to create order",
      });
    }
  },
);

/* Customer tracking requires order number + phone and excludes contact data. */
router.get(
  "/orders/track",
  async (req: Request, res: Response) => {
    try {
      const orderNumber = clean(req.query.orderNumber, 80).toUpperCase();
      const phone = clean(req.query.phone, 40);

      if (!orderNumber || !phone) {
        return res.status(400).json({
          success: false,
          message: "Order number and buyer phone are required",
        });
      }

      const { data: order, error } = await supabase
        .from("shop_orders")
        .select(
          "id,order_number,status,payment_status,tracking_code,total,currency,created_at,updated_at,shop_id,business_shops(name,store_slug)",
        )
        .eq("order_number", orderNumber)
        .eq("buyer_phone", phone)
        .maybeSingle();

      if (error) throw error;
      if (!order) {
        return res.status(404).json({
          success: false,
          message: "Order not found. Check the order number and phone number.",
        });
      }

      const { data: events } = await supabase
        .from("shop_order_events")
        .select("status,note,created_at")
        .eq("order_id", order.id)
        .order("created_at", { ascending: true });

      const { data: items } = await supabase
        .from("shop_order_items")
        .select("product_name,quantity,unit_price,line_total")
        .eq("order_id", order.id);

      const shopInfo = Array.isArray(order.business_shops)
        ? order.business_shops[0]
        : order.business_shops;

      return res.json({
        success: true,
        order: {
          orderNumber: order.order_number,
          status: order.status,
          paymentStatus: order.payment_status,
          trackingCode: order.tracking_code,
          total: Number(order.total),
          currency: order.currency,
          createdAt: order.created_at,
          updatedAt: order.updated_at,
          shop: shopInfo?.name ?? "VSBIL Shop",
          items: items ?? [],
          timeline: events ?? [],
        },
      });
    } catch (error) {
      console.error("Order tracking", error);
      return res.status(500).json({
        success: false,
        message: "Unable to track order",
      });
    }
  },
);

/* Owner storefront settings. */
router.get(
  "/shops/:shopId/store-settings",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { data: shop } = await supabase
        .from("business_shops")
        .select(
          "id,name,description,logo_url,phone,address,store_slug,is_published,whatsapp_bot_id,whatsapp_auto_reply",
        )
        .eq("id", req.params.shopId)
        .eq("user_id", req.user!.id)
        .maybeSingle();

      if (!shop) {
        return res.status(404).json({ success: false, message: "Shop not found" });
      }

      return res.json({ success: true, shop });
    } catch (error) {
      console.error("Store settings", error);
      return res.status(500).json({
        success: false,
        message: "Unable to load shop settings",
      });
    }
  },
);

router.patch(
  "/shops/:shopId/store-settings",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { data: shop } = await supabase
        .from("business_shops")
        .select("id")
        .eq("id", req.params.shopId)
        .eq("user_id", req.user!.id)
        .maybeSingle();

      if (!shop) {
        return res.status(404).json({ success: false, message: "Shop not found" });
      }

      const patch: Record<string, unknown> = {};
      for (const key of ["name", "description", "logo_url", "phone", "address"] as const) {
        if (req.body?.[key] !== undefined) {
          patch[key] = clean(req.body[key], key === "description" ? 2000 : 1000) || null;
        }
      }

      if (req.body?.storeSlug !== undefined) {
        const nextSlug = makeSlug(req.body.storeSlug);
        if (nextSlug.length < 3) {
          return res.status(400).json({
            success: false,
            message: "Store URL must be at least 3 characters",
          });
        }
        patch.store_slug = await uniqueStoreSlug(nextSlug, req.user!.id);
      }

      if (req.body?.isPublished !== undefined) {
        const publish = Boolean(req.body.isPublished);
        if (publish && !(await hasPlan(req.user!.id, "inventory"))) {
          return res.status(402).json({
            success: false,
            message: "An active shop subscription is required to publish your storefront",
            code: "SHOP_SUBSCRIPTION_REQUIRED",
          });
        }
        patch.is_published = publish;
      }

      if (req.body?.whatsappAutoReply !== undefined) {
        patch.whatsapp_auto_reply = Boolean(req.body.whatsappAutoReply);
      }

      const { data, error } = await supabase
        .from("business_shops")
        .update(patch)
        .eq("id", shop.id)
        .eq("user_id", req.user!.id)
        .select(
          "id,name,description,logo_url,phone,address,store_slug,is_published,whatsapp_bot_id,whatsapp_auto_reply",
        )
        .single();

      if (error) {
        if (error.code === "23505") {
          return res.status(409).json({
            success: false,
            message: "That store URL is already in use",
          });
        }
        throw error;
      }

      return res.json({ success: true, shop: data });
    } catch (error) {
      console.error("Update store settings", error);
      return res.status(500).json({
        success: false,
        message: "Unable to update storefront",
      });
    }
  },
);

/* Real product management fields for the existing inventory catalogue. */
router.patch(
  "/shops/:shopId/products/:productId",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { data: shop } = await supabase
        .from("business_shops")
        .select("id")
        .eq("id", req.params.shopId)
        .eq("user_id", req.user!.id)
        .maybeSingle();

      if (!shop) {
        return res.status(404).json({ success: false, message: "Shop not found" });
      }

      const patch: Record<string, unknown> = {};
      if (req.body?.name !== undefined) patch.name = clean(req.body.name, 160);
      if (req.body?.sku !== undefined) patch.sku = clean(req.body.sku, 80).toUpperCase();
      if (req.body?.description !== undefined) patch.description = clean(req.body.description, 2000) || null;
      if (req.body?.imageUrl !== undefined) patch.image_url = clean(req.body.imageUrl, 1000) || null;
      if (req.body?.sellingPrice !== undefined) patch.selling_price = num(req.body.sellingPrice);
      if (req.body?.costPrice !== undefined) patch.cost_price = num(req.body.costPrice);
      if (req.body?.quantity !== undefined) patch.quantity = Math.floor(num(req.body.quantity));
      if (req.body?.reorderLevel !== undefined) patch.reorder_level = Math.floor(num(req.body.reorderLevel));
      if (req.body?.unit !== undefined) patch.unit = clean(req.body.unit, 30) || "piece";
      if (req.body?.discountPercent !== undefined) {
        patch.discount_percent = Math.min(Math.max(num(req.body.discountPercent), 0), 100);
      }
      if (req.body?.isPublished !== undefined) {
        patch.is_published = Boolean(req.body.isPublished);
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({
          success: false,
          message: "No product changes were supplied",
        });
      }

      const { data, error } = await supabase
        .from("inventory_products")
        .update(patch)
        .eq("id", req.params.productId)
        .eq("shop_id", shop.id)
        .eq("user_id", req.user!.id)
        .select("*")
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return res.status(404).json({ success: false, message: "Product not found" });
      }

      return res.json({ success: true, product: data });
    } catch (error) {
      console.error("Update shop product", error);
      return res.status(500).json({
        success: false,
        message: "Unable to update product",
      });
    }
  },
);

/* Connect an already connected WhatsApp Business bot to this shop. */
router.patch(
  "/shops/:shopId/whatsapp",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      if (!(await hasPlan(req.user!.id, "inventory")) || !(await hasPlan(req.user!.id, "whatsapp"))) {
        return res.status(402).json({
          success: false,
          message: "An active shop subscription and WhatsApp subscription are required for the integration",
          code: "BUNDLE_REQUIRED",
        });
      }

      const { data: shop } = await supabase
        .from("business_shops")
        .select("id")
        .eq("id", req.params.shopId)
        .eq("user_id", req.user!.id)
        .maybeSingle();

      if (!shop) {
        return res.status(404).json({ success: false, message: "Shop not found" });
      }

      const { data: bot } = await supabase
        .from("whatsapp_bots")
        .select("id,status")
        .eq("id", clean(req.body?.botId, 80))
        .eq("user_id", req.user!.id)
        .maybeSingle();

      if (!bot || bot.status !== "connected") {
        return res.status(400).json({
          success: false,
          message: "Connect an active WhatsApp Business bot first",
        });
      }

      const { data, error } = await supabase
        .from("business_shops")
        .update({
          whatsapp_bot_id: bot.id,
          whatsapp_auto_reply: req.body?.enabled !== false,
        })
        .eq("id", shop.id)
        .eq("user_id", req.user!.id)
        .select("id,whatsapp_bot_id,whatsapp_auto_reply")
        .single();

      if (error) throw error;
      return res.json({ success: true, shop: data });
    } catch (error) {
      console.error("Shop WhatsApp link", error);
      return res.status(500).json({
        success: false,
        message: "Unable to connect shop to WhatsApp",
      });
    }
  },
);

/* Owner order management. */
router.get(
  "/shops/:shopId/orders",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { data: shop } = await supabase
        .from("business_shops")
        .select("id")
        .eq("id", req.params.shopId)
        .eq("user_id", req.user!.id)
        .maybeSingle();

      if (!shop) {
        return res.status(404).json({ success: false, message: "Shop not found" });
      }

      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      const { data, error } = await supabase
        .from("shop_orders")
        .select(
          "id,order_number,buyer_name,buyer_phone,buyer_email,delivery_address,subtotal,discount_amount,delivery_fee,total,payment_method,payment_status,status,tracking_code,created_at,updated_at",
        )
        .eq("shop_id", shop.id)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return res.json({ success: true, orders: data ?? [] });
    } catch (error) {
      console.error("Shop orders", error);
      return res.status(500).json({
        success: false,
        message: "Unable to load shop orders",
      });
    }
  },
);

router.patch(
  "/shops/:shopId/orders/:orderId",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const allowed = [
        "pending",
        "confirmed",
        "processing",
        "ready",
        "shipped",
        "delivered",
        "cancelled",
        "refunded",
      ];
      const status = clean(req.body?.status, 30);

      if (!allowed.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid order status",
        });
      }

      const { data: shop } = await supabase
        .from("business_shops")
        .select("id")
        .eq("id", req.params.shopId)
        .eq("user_id", req.user!.id)
        .maybeSingle();

      if (!shop) {
        return res.status(404).json({ success: false, message: "Shop not found" });
      }

      const patch: Record<string, unknown> = { status };
      if (req.body?.trackingCode !== undefined) {
        patch.tracking_code = clean(req.body.trackingCode, 120) || null;
      }

      const { data, error } = await supabase
        .from("shop_orders")
        .update(patch)
        .eq("id", req.params.orderId)
        .eq("shop_id", shop.id)
        .select("id,order_number,status,payment_status,tracking_code,total,currency,updated_at")
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return res.status(404).json({ success: false, message: "Order not found" });
      }

      const { error: eventError } = await supabase
        .from("shop_order_events")
        .insert({
          order_id: data.id,
          status,
          note: clean(req.body?.note, 500) || null,
        });

      if (eventError) throw eventError;
      return res.json({ success: true, order: data });
    } catch (error) {
      console.error("Order status", error);
      return res.status(500).json({
        success: false,
        message: "Unable to update order",
      });
    }
  },
);

router.get("/plans", (_req: Request, res: Response) =>
  res.json({
    success: true,
    plans: [
      { id: "inventory", name: "Shop Pro", amount: 150, currency: "GHS", period: "month" },
      { id: "whatsapp", name: "WhatsApp Automation", amount: 150, currency: "GHS", period: "month" },
      {
        id: "shop_whatsapp_bundle",
        name: "Shop + WhatsApp Bundle",
        amount: 250,
        currency: "GHS",
        period: "month",
        savings: 50,
      },
    ],
  }),
);

export default router;
