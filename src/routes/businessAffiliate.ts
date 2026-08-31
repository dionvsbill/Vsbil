import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { supabase } from "../config/supabase.js";

const router = Router();
const clean = (value: unknown, max = 2000): string => typeof value === "string" ? value.trim().slice(0, max) : "";

function safeUrl(value: unknown): string | null {
  const raw = clean(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch { return null; }
}

router.patch("/shops/:shopId/affiliate", requireAuth, async (req: Request, res: Response) => {
  const url = safeUrl(req.body?.affiliateLink);
  const provider = clean(req.body?.provider, 40) || null;
  const { data, error } = await supabase.from("business_shops").update({ affiliate_link: url, affiliate_provider: provider }).eq("id", req.params.shopId).eq("user_id", req.user!.id).select("id,affiliate_link,affiliate_provider").maybeSingle();
  if (error) return res.status(400).json({ success: false, message: "Unable to save affiliate settings" });
  if (!data) return res.status(404).json({ success: false, message: "Shop not found" });
  return res.json({ success: true, affiliate: data });
});

router.patch("/products/:productId/affiliate", requireAuth, async (req: Request, res: Response) => {
  const url = safeUrl(req.body?.affiliateLink);
  const { data, error } = await supabase.from("inventory_products").update({ affiliate_link: url }).eq("id", req.params.productId).eq("user_id", req.user!.id).select("id,affiliate_link").maybeSingle();
  if (error) return res.status(400).json({ success: false, message: "Unable to save product affiliate link" });
  if (!data) return res.status(404).json({ success: false, message: "Product not found" });
  return res.json({ success: true, affiliate: data });
});

router.get("/products/:productId/affiliate", requireAuth, async (req: Request, res: Response) => {
  const { data, error } = await supabase.from("inventory_products").select("id,affiliate_link,source,source_url").eq("id", req.params.productId).eq("user_id", req.user!.id).maybeSingle();
  if (error) return res.status(500).json({ success: false, message: "Unable to load affiliate settings" });
  if (!data) return res.status(404).json({ success: false, message: "Product not found" });
  return res.json({ success: true, affiliate: data });
});

export default router;
