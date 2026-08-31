import { Router, type Request, type Response } from "express";
import { supabase } from "../config/supabase.js";
import { requireAdmin, requireIdentity } from "../middleware/authMiddleware.js";

const router = Router();
const money = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
};
const text = (value: unknown, max = 200) => typeof value === "string" ? value.trim().slice(0, max) : "";

router.post("/posts/:id/view", requireIdentity, async (req: Request, res: Response) => {
  try {
    const postId = text(req.params.id, 80);
    if (!postId) return res.status(400).json({ success: false, message: "Post is required" });
    const { data, error } = await supabase.rpc("record_social_post_view", { p_post: postId, p_user: req.user!.id });
    if (error) throw error;
    return res.json({ success: true, counted: Boolean(data) });
  } catch (error) {
    console.error("social view", error);
    return res.status(400).json({ success: false, message: "Unable to record post view" });
  }
});

router.get("/posts/:id/metrics", requireIdentity, async (req: Request, res: Response) => {
  try {
    const postId = text(req.params.id, 80);
    const [{ count: likes }, { count: comments }, { count: views }] = await Promise.all([
      supabase.from("social_post_likes").select("post_id", { count: "exact", head: true }).eq("post_id", postId),
      supabase.from("social_comments").select("id", { count: "exact", head: true }).eq("post_id", postId).eq("moderation_status", "approved"),
      supabase.from("social_post_views").select("id", { count: "exact", head: true }).eq("post_id", postId),
    ]);
    return res.json({ success: true, metrics: { likes: likes ?? 0, comments: comments ?? 0, views: views ?? 0 } });
  } catch (error) {
    console.error("social metrics", error);
    return res.status(500).json({ success: false, message: "Unable to load post metrics" });
  }
});

router.get("/earnings", requireIdentity, async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase.from("social_creator_earnings").select("id,amount,currency,score,status,created_at,period_id").eq("user_id", req.user!.id).order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    const total = (data ?? []).reduce((sum: number, row: { amount: number | string }) => sum + Number(row.amount || 0), 0);
    return res.json({ success: true, total: Math.round(total * 100) / 100, currency: "GHS", earnings: data ?? [] });
  } catch (error) {
    console.error("social earnings", error);
    return res.status(500).json({ success: false, message: "Unable to load creator earnings" });
  }
});

router.get("/admin/ad-revenue", requireIdentity, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase.from("social_ad_revenue_periods").select("id,external_reference,period_start,period_end,gross_revenue,creator_share_rate,creator_pool,platform_revenue,currency,status,source,created_at,allocated_at").order("period_end", { ascending: false }).limit(100);
    if (error) throw error;
    return res.json({ success: true, periods: data ?? [] });
  } catch (error) {
    console.error("social ad revenue list", error);
    return res.status(500).json({ success: false, message: "Unable to load ad revenue periods" });
  }
});

router.post("/admin/ad-revenue", requireIdentity, requireAdmin, async (req: Request, res: Response) => {
  try {
    const externalReference = text(req.body?.externalReference, 120);
    const grossRevenue = money(req.body?.grossRevenue);
    const creatorShareRate = req.body?.creatorShareRate === undefined ? 0.55 : Number(req.body.creatorShareRate);
    const periodStart = new Date(String(req.body?.periodStart ?? ""));
    const periodEnd = new Date(String(req.body?.periodEnd ?? ""));
    const source = text(req.body?.source, 40) || "ads";
    if (!externalReference || !Number.isFinite(grossRevenue) || grossRevenue <= 0 || !Number.isFinite(creatorShareRate) || creatorShareRate < 0 || creatorShareRate > 1 || Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime()) || periodEnd <= periodStart) {
      return res.status(400).json({ success: false, message: "Revenue reference, amount, share rate and valid period are required" });
    }
    const { data, error } = await supabase.from("social_ad_revenue_periods").insert({ external_reference: externalReference, period_start: periodStart.toISOString(), period_end: periodEnd.toISOString(), gross_revenue: grossRevenue, creator_share_rate: creatorShareRate, currency: "GHS", source, metadata: req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {}, created_by: req.user!.id }).select("id,external_reference,period_start,period_end,gross_revenue,creator_share_rate,creator_pool,platform_revenue,status,source,created_at").single();
    if (error) return res.status(error.code === "23505" ? 409 : 400).json({ success: false, message: error.code === "23505" ? "Revenue reference already exists" : error.message });
    return res.status(201).json({ success: true, period: data });
  } catch (error) {
    console.error("social ad revenue create", error);
    return res.status(500).json({ success: false, message: "Unable to record ad revenue" });
  }
});

router.post("/admin/ad-revenue/:id/allocate", requireIdentity, requireAdmin, async (req: Request, res: Response) => {
  try {
    const periodId = text(req.params.id, 80);
    const { data, error } = await supabase.rpc("allocate_social_ad_revenue", { p_period: periodId });
    if (error) throw error;
    return res.json({ success: true, allocation: data });
  } catch (error) {
    console.error("social ad revenue allocate", error);
    return res.status(400).json({ success: false, message: "Unable to allocate creator revenue" });
  }
});

export default router;
