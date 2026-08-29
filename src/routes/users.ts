import { Router, type Request, type Response } from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = Router();
router.use(requireAuth);

router.get("/referrals", async (req, res) => {
  const [{ data: user, error: userError }, { data: rows, error: referralError }] = await Promise.all([
    supabase.from("users").select("referral_code").eq("id", req.user!.id).single(),
    supabase.from("referrals").select("id,new_user_bonus_coins,referrer_bonus_coins,status,created_at,referred_user_id,qualified_at").eq("referrer_id", req.user!.id).order("created_at", { ascending: false }).limit(200),
  ]);
  if (userError || referralError) return res.status(500).json({ success: false, message: "Unable to load referrals" });
  return res.json({ success: true, referralCode: user?.referral_code ?? null, referrals: rows ?? [] });
});

router.get("/profile", async (req, res) => {
  const { data, error } = await supabase
    .from("users")
    .select("id,email,username,role,status,referral_code,created_at,updated_at,email_verified_at,google_verified_at,phone_verified_at,last_login_at,last_active_at,suspended_at,suspension_reason")
    .eq("id", req.user!.id)
    .single();
  if (error) return res.status(500).json({ success: false, message: "Unable to load profile" });
  return res.json({ success: true, user: data });
});

router.patch("/profile", async (req: Request, res: Response) => {
  const username = String(req.body?.username ?? "").trim();
  if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) return res.status(400).json({ success: false, message: "Username must be 3–30 characters and use letters, numbers, dot, dash or underscore." });
  const { data, error } = await supabase
    .from("users")
    .update({ username, updated_at: new Date().toISOString() })
    .eq("id", req.user!.id)
    .select("id,email,username,role,status,referral_code,created_at,updated_at,email_verified_at,google_verified_at,phone_verified_at")
    .single();
  if (error) {
    const duplicate = error.code === "23505" || error.message.toLowerCase().includes("unique");
    return res.status(400).json({ success: false, message: duplicate ? "That username is already in use." : "Unable to update profile." });
  }
  await supabase.from("security_events").insert({ user_id: req.user!.id, event_type: "profile_updated", severity: "info", metadata: { fields: ["username"] } });
  return res.json({ success: true, user: data });
});

export default router;
