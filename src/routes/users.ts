import { Router } from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middleware/authMiddleware.js";
const router = Router();
router.use(requireAuth);
router.get("/referrals", async (req, res) => {
  const [{ data: user }, { data: rows }] = await Promise.all([
    supabase.from("users").select("referral_code").eq("id", req.user!.id).single(),
    supabase.from("referrals").select("id,bonus_amount,status,created_at,referred_user_id").eq("referrer_id", req.user!.id).order("created_at", { ascending: false }).limit(200),
  ]);
  return res.json({ success: true, referralCode: user?.referral_code ?? null, referrals: rows ?? [] });
});
router.get("/profile", async (req, res) => {
  const { data, error } = await supabase.from("users").select("id,email,username,role,status,referral_code,created_at").eq("id", req.user!.id).single();
  if (error) return res.status(500).json({ success: false, message: "Unable to load profile" });
  return res.json({ success: true, user: data });
});
export default router;
