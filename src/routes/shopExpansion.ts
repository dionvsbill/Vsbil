import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { supabase } from "../config/supabase.js";
import { requireAuth, requireAdmin } from "../middleware/authMiddleware.js";

const router = Router();
const clean = (v: unknown, max = 500): string => typeof v === "string" ? v.trim().slice(0, max) : "";
const money = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.round(n * 100) / 100) : 0; };
const hash = (v: string): string => crypto.createHash("sha256").update(`${v}:${process.env.APP_STATE_SECRET ?? ""}`).digest("hex");

async function ownerShop(req: Request, res: Response) {
  const { data } = await supabase.from("business_shops").select("*").eq("id", req.params.shopId).eq("user_id", req.user!.id).maybeSingle();
  if (!data) { res.status(404).json({ success: false, message: "Shop not found" }); return null; }
  return data;
}

router.get("/:shopId/overview", requireAuth, async (req, res) => {
  try {
    const shop = await ownerShop(req, res); if (!shop) return;
    const [{ count: products }, { count: orders }, { count: customers }, { data: recentOrders }] = await Promise.all([
      supabase.from("inventory_products").select("id", { count: "exact", head: true }).eq("shop_id", shop.id),
      supabase.from("shop_orders").select("id", { count: "exact", head: true }).eq("shop_id", shop.id),
      supabase.from("shop_customers").select("id", { count: "exact", head: true }).eq("shop_id", shop.id),
      supabase.from("shop_orders").select("id,order_number,total,status,payment_status,created_at").eq("shop_id", shop.id).order("created_at", { ascending: false }).limit(8),
    ]);
    const { data: revenueRows } = await supabase.from("shop_orders").select("total,payment_status,escrow_status").eq("shop_id", shop.id).in("payment_status", ["paid"]);
    const gross = (revenueRows ?? []).reduce((s, x) => s + money(x.total), 0);
    const { data: holdRows } = await supabase.from("shop_wallet_holds").select("net_amount").eq("shop_id", shop.id).eq("status", "held");
    const pending = (holdRows ?? []).reduce((s, x) => s + money(x.net_amount), 0);
    return res.json({ success: true, shop, stats: { products: products ?? 0, orders: orders ?? 0, customers: customers ?? 0, grossRevenue: gross, pendingSettlement: pending }, recentOrders: recentOrders ?? [] });
  } catch (e) { console.error("Shop overview", e); return res.status(500).json({ success: false, message: "Unable to load shop overview" }); }
});

router.get("/:shopId/customers", requireAuth, async (req, res) => {
  try { const shop = await ownerShop(req, res); if (!shop) return; const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200); const { data, error } = await supabase.from("shop_customers").select("id,phone,name,email,address,order_count,total_spent,last_order_at,created_at").eq("shop_id", shop.id).order("last_order_at", { ascending: false }).limit(limit); if (error) throw error; return res.json({ success: true, customers: data ?? [] }); }
  catch (e) { console.error("Shop customers", e); return res.status(500).json({ success: false, message: "Unable to load customers" }); }
});

router.get("/:shopId/analytics", requireAuth, async (req, res) => {
  try {
    const shop = await ownerShop(req, res); if (!shop) return;
    const [{ data: orders }, { data: clicks }] = await Promise.all([
      supabase.from("shop_orders").select("total,payment_status,status,created_at").eq("shop_id", shop.id).order("created_at", { ascending: false }).limit(1000),
      supabase.from("jforce_clicks").select("id,product_id,created_at").eq("shop_id", shop.id).order("created_at", { ascending: false }).limit(1000),
    ]);
    const byDay: Record<string, { orders: number; revenue: number }> = {};
    for (const o of orders ?? []) { const day = String(o.created_at).slice(0, 10); byDay[day] ??= { orders: 0, revenue: 0 }; byDay[day].orders++; if (o.payment_status === "paid") byDay[day].revenue += money(o.total); }
    return res.json({ success: true, analytics: { orderCount: orders?.length ?? 0, paidRevenue: (orders ?? []).filter(o => o.payment_status === "paid").reduce((s, o) => s + money(o.total), 0), jforceClicks: clicks?.length ?? 0, daily: Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).slice(-30).map(([date, value]) => ({ date, ...value })) } });
  } catch (e) { console.error("Shop analytics", e); return res.status(500).json({ success: false, message: "Unable to load analytics" }); }
});

router.get("/:shopId/subscription", requireAuth, async (req, res) => {
  try { const shop = await ownerShop(req, res); if (!shop) return; const { data: sub } = await supabase.from("business_subscriptions").select("product,plan,status,starts_at,ends_at").eq("user_id", req.user!.id).eq("product", "shop").maybeSingle(); const active = sub?.status === "active" && (!sub.ends_at || new Date(sub.ends_at).getTime() > Date.now()); return res.json({ success: true, subscription: sub ? { ...sub, active } : null, limits: active && sub?.plan === "pro" ? { products: 1000, conversations: 1000, feePercent: 3 } : { products: 20, conversations: 100, feePercent: 5 } }); }
  catch (e) { console.error("Shop subscription", e); return res.status(500).json({ success: false, message: "Unable to load shop subscription" }); }
});

router.post("/:shopId/jforce-click", async (req, res) => {
  try {
    const shopId = clean(req.params.shopId, 80), productId = clean(req.body?.productId, 80), url = clean(req.body?.affiliateUrl, 2000); if (!url) return res.status(400).json({ success: false, message: "Affiliate URL is required" }); const parsed = new URL(url); if (parsed.protocol !== "https:") return res.status(400).json({ success: false, message: "Only HTTPS affiliate URLs are allowed" });
    const { data: shop } = await supabase.from("business_shops").select("id").eq("id", shopId).eq("is_published", true).maybeSingle(); if (!shop) return res.status(404).json({ success: false, message: "Shop not found" });
    await supabase.from("jforce_clicks").insert({ shop_id: shop.id, product_id: productId || null, affiliate_url: parsed.toString(), referrer: clean(req.get("referer"), 1000) || null, user_agent_hash: hash(clean(req.get("user-agent"), 1000)), ip_hash: hash(String(req.ip ?? "unknown")) });
    return res.redirect(302, parsed.toString());
  } catch { return res.status(400).json({ success: false, message: "Invalid affiliate destination" }); }
});

router.get("/:shopId/jforce-clicks", requireAuth, async (req, res) => {
  try { const shop = await ownerShop(req, res); if (!shop) return; const { data, error } = await supabase.from("jforce_clicks").select("id,product_id,affiliate_url,created_at").eq("shop_id", shop.id).order("created_at", { ascending: false }).limit(200); if (error) throw error; return res.json({ success: true, clicks: data ?? [] }); }
  catch (e) { console.error("JForce clicks", e); return res.status(500).json({ success: false, message: "Unable to load affiliate clicks" }); }
});

router.get("/:shopId/whatsapp/flows", requireAuth, async (req, res) => {
  try { const shop = await ownerShop(req, res); if (!shop) return; const { data, error } = await supabase.from("whatsapp_shop_flows").select("id,trigger_keyword,action_type,action_config,is_enabled,created_at,updated_at").eq("shop_id", shop.id).order("trigger_keyword"); if (error) throw error; return res.json({ success: true, flows: data ?? [] }); }
  catch (e) { console.error("Shop WhatsApp flows", e); return res.status(500).json({ success: false, message: "Unable to load WhatsApp flows" }); }
});

router.post("/:shopId/whatsapp/flows", requireAuth, async (req, res) => {
  try { const shop = await ownerShop(req, res); if (!shop) return; const keyword = clean(req.body?.triggerKeyword, 80).toLowerCase(); const action = clean(req.body?.actionType, 50); const allowed = new Set(["send_message","send_product_list","send_product","create_order","send_payment_link","check_order_status"]); if (!keyword || !allowed.has(action)) return res.status(400).json({ success: false, message: "Trigger and valid action are required" }); const { data, error } = await supabase.from("whatsapp_shop_flows").insert({ shop_id: shop.id, trigger_keyword: keyword, action_type: action, action_config: req.body?.actionConfig && typeof req.body.actionConfig === "object" ? req.body.actionConfig : {}, is_enabled: req.body?.isEnabled !== false }).select().single(); if (error) return res.status(error.code === "23505" ? 409 : 400).json({ success: false, message: error.code === "23505" ? "That trigger already exists" : "Unable to save flow" }); return res.status(201).json({ success: true, flow: data }); }
  catch (e) { console.error("Create WhatsApp shop flow", e); return res.status(500).json({ success: false, message: "Unable to save WhatsApp flow" }); }
});

router.patch("/:shopId/whatsapp/flows/:flowId", requireAuth, async (req, res) => {
  try { const shop = await ownerShop(req, res); if (!shop) return; const patch: Record<string, unknown> = {}; if (req.body?.triggerKeyword !== undefined) patch.trigger_keyword = clean(req.body.triggerKeyword, 80).toLowerCase(); if (req.body?.actionType !== undefined) patch.action_type = clean(req.body.actionType, 50); if (req.body?.actionConfig !== undefined) patch.action_config = req.body.actionConfig && typeof req.body.actionConfig === "object" ? req.body.actionConfig : {}; if (req.body?.isEnabled !== undefined) patch.is_enabled = Boolean(req.body.isEnabled); patch.updated_at = new Date().toISOString(); const { data, error } = await supabase.from("whatsapp_shop_flows").update(patch).eq("id", req.params.flowId).eq("shop_id", shop.id).select().maybeSingle(); if (error) throw error; if (!data) return res.status(404).json({ success: false, message: "Flow not found" }); return res.json({ success: true, flow: data }); }
  catch (e) { console.error("Update WhatsApp shop flow", e); return res.status(500).json({ success: false, message: "Unable to update flow" }); }
});

router.delete("/:shopId/whatsapp/flows/:flowId", requireAuth, async (req, res) => {
  try { const shop = await ownerShop(req, res); if (!shop) return; const { error } = await supabase.from("whatsapp_shop_flows").delete().eq("id", req.params.flowId).eq("shop_id", shop.id); if (error) throw error; return res.json({ success: true }); }
  catch (e) { console.error("Delete WhatsApp shop flow", e); return res.status(500).json({ success: false, message: "Unable to delete flow" }); }
});

router.post("/:shopId/orders/:orderId/confirm-delivery", requireAuth, async (req, res) => {
  try { const shop = await ownerShop(req, res); if (!shop) return; const { data: order } = await supabase.from("shop_orders").select("id,status,payment_status,escrow_status").eq("id", req.params.orderId).eq("shop_id", shop.id).maybeSingle(); if (!order) return res.status(404).json({ success: false, message: "Order not found" }); if (order.status !== "delivered") return res.status(409).json({ success: false, message: "Mark the order delivered before releasing settlement" }); const { data, error } = await supabase.rpc("release_shop_order", { p_order_id: order.id, p_actor_id: req.user!.id }); if (error) throw error; return res.json({ success: true, order: Array.isArray(data) ? data[0] : data }); }
  catch (e) { console.error("Confirm shop delivery", e); return res.status(409).json({ success: false, message: e instanceof Error ? e.message : "Unable to release settlement" }); }
});

router.get("/admin/shops", requireAuth, requireAdmin, async (_req, res) => {
  try { const { data, error } = await supabase.from("business_shops").select("id,user_id,name,store_slug,is_published,shop_status,is_pro,pro_expires_at,created_at").order("created_at", { ascending: false }).limit(500); if (error) throw error; return res.json({ success: true, shops: data ?? [] }); }
  catch (e) { console.error("Admin shops", e); return res.status(500).json({ success: false, message: "Unable to load shops" }); }
});

router.patch("/admin/shops/:shopId", requireAuth, requireAdmin, async (req, res) => {
  try { const status = clean(req.body?.status, 30); if (!["pending","approved","rejected","suspended"].includes(status)) return res.status(400).json({ success: false, message: "Invalid shop status" }); const { data, error } = await supabase.from("business_shops").update({ shop_status: status, is_published: status === "approved" }).eq("id", req.params.shopId).select("id,name,store_slug,shop_status,is_published,is_pro,pro_expires_at").maybeSingle(); if (error) throw error; if (!data) return res.status(404).json({ success: false, message: "Shop not found" }); await supabase.from("audit_events").insert({ actor_id: req.user!.id, target_user_id: data.id, event_type: "shop_status_update", metadata: { shop_id: data.id, status } }); return res.json({ success: true, shop: data }); }
  catch (e) { console.error("Admin shop update", e); return res.status(500).json({ success: false, message: "Unable to update shop" }); }
});

export default router;
