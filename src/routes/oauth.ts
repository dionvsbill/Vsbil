import { Router, type Request, type Response } from "express";
import { supabase } from "../config/supabase.js";

const router = Router();
const REFERRAL_PATTERN = /^[A-Z0-9_-]{1,50}$/i;
const NEW_ACCOUNT_WINDOW_MS = 15 * 60 * 1000;

function normalizeReferral(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return code && REFERRAL_PATTERN.test(code) ? code : null;
}

function bearer(req: Request): string | null {
  const header = String(req.headers.authorization ?? "");
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  return header.slice(7).trim() || null;
}

router.get("/google", async (req: Request, res: Response) => {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const appUrl = process.env.APP_URL?.replace(/\/$/, "");
  if (!supabaseUrl || !appUrl) {
    return res.status(503).json({ success: false, message: "Google authentication is not configured", code: "GOOGLE_AUTH_NOT_CONFIGURED" });
  }

  const referralCode = normalizeReferral(req.query.ref);
  const redirectTo = new URL(`${appUrl}/auth-callback.html`);
  if (referralCode) redirectTo.searchParams.set("ref", referralCode);

  const url = `${supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo.toString())}`;
  return res.json({ success: true, url, referralPreserved: Boolean(referralCode) });
});

router.post("/attach-referral", async (req: Request, res: Response) => {
  try {
    const accessToken = bearer(req);
    const referralCode = normalizeReferral(req.body?.referralCode);
    if (!accessToken) return res.status(401).json({ success: false, message: "Authentication is required.", code: "AUTH_REQUIRED" });
    if (!referralCode) return res.status(400).json({ success: false, message: "Referral code is invalid.", code: "INVALID_REFERRAL_CODE" });

    const { data: auth, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !auth.user) return res.status(401).json({ success: false, message: "Your Google session is invalid or expired.", code: "INVALID_TOKEN" });

    const { data: user, error: userError } = await supabase.from("users").select("id,referred_by,created_at").eq("id", auth.user.id).maybeSingle();
    if (userError || !user) return res.status(404).json({ success: false, message: "Your VSBIL profile could not be found.", code: "PROFILE_NOT_FOUND" });

    // Referral attribution is immutable and only available immediately after a new account is created.
    if (user.referred_by) return res.json({ success: true, attached: false, reason: "REFERRAL_ALREADY_SET" });
    const createdAt = new Date(user.created_at).getTime();
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > NEW_ACCOUNT_WINDOW_MS) {
      return res.json({ success: true, attached: false, reason: "ACCOUNT_NOT_NEW" });
    }

    const { data: referrer, error: referrerError } = await supabase.from("users").select("id").eq("referral_code", referralCode).maybeSingle();
    if (referrerError) return res.status(500).json({ success: false, message: "Unable to validate the referral code.", code: "REFERRAL_LOOKUP_FAILED" });
    if (!referrer) return res.status(400).json({ success: false, message: "That referral code is invalid.", code: "INVALID_REFERRAL_CODE" });
    if (referrer.id === user.id) return res.status(400).json({ success: false, message: "You cannot use your own referral code.", code: "SELF_REFERRAL" });

    const { data: updated, error: updateError } = await supabase.from("users").update({ referred_by: referrer.id, updated_at: new Date().toISOString() }).eq("id", user.id).is("referred_by", null).select("id,referred_by").maybeSingle();
    if (updateError) return res.status(500).json({ success: false, message: "Unable to save the referral attribution.", code: "REFERRAL_UPDATE_FAILED" });

    return res.json({ success: true, attached: Boolean(updated), referralCode });
  } catch (error) {
    console.error("Google referral attribution failed", error);
    return res.status(503).json({ success: false, message: "Unable to process the referral right now.", code: "REFERRAL_SERVICE_UNAVAILABLE" });
  }
});

export default router;
