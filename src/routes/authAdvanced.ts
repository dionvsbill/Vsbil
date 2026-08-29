import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { supabase } from "../config/supabase.js";
import { requireIdentity } from "../middleware/authMiddleware.js";
import { randomCode } from "../services/cryptoVault.js";

const router = Router();
const CODE_TTL_MS = 10 * 60 * 1000;
const RESET_TTL_MS = 15 * 60 * 1000;
const MAGIC_TTL_MS = 15 * 60 * 1000;
const COOLDOWN_MS = 60_000;
const MAX_ATTEMPTS = 5;

function hash(value: string): string {
  return crypto.createHash("sha256").update(`${value}:${process.env.APP_STATE_SECRET ?? ""}`).digest("hex");
}
function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
async function sendEmail(to: string, subject: string, text: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [to], subject, text, html }) });
  if (!r.ok) throw new Error(`EMAIL_SEND_FAILED:${r.status}`);
}
async function latestCode(userId: string, purpose: string) {
  return supabase.from("email_verification_codes").select("*").eq("user_id", userId).eq("purpose", purpose).is("used_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
}
async function issueCode(userId: string, email: string, purpose: "email_verification" | "email_change" | "password_reset" | "security_verification", ttl: number) {
  const latest = await latestCode(userId, purpose);
  if (latest.data && Date.now() - new Date(latest.data.created_at).getTime() < COOLDOWN_MS) throw new Error("COOLDOWN");
  const code = randomCode();
  const { error } = await supabase.from("email_verification_codes").insert({ user_id: userId, email, code_hash: hash(code), purpose, expires_at: new Date(Date.now() + ttl).toISOString(), attempts: 0, max_attempts: MAX_ATTEMPTS });
  if (error) throw error;
  return code;
}

// Public email confirmation: signup sends a 6-digit code; confirmation promotes the Auth user.
router.post("/signup/confirm", async (req: Request, res: Response) => {
  try {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const code = String(req.body?.code ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) return res.status(400).json({ success: false, message: "Enter your email and the 6-digit code." });
    const { data: user } = await supabase.from("users").select("id,email_verified_at").eq("email", email).maybeSingle();
    if (!user) return res.status(400).json({ success: false, message: "We could not find that account." });
    const { data: record } = await supabase.from("email_verification_codes").select("*").eq("user_id", user.id).eq("purpose", "email_verification").is("used_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!record) return res.status(400).json({ success: false, message: "No active verification code was found." });
    if (record.attempts >= record.max_attempts || new Date(record.expires_at).getTime() < Date.now()) return res.status(400).json({ success: false, message: "This code is no longer valid. Request a new one." });
    if (!safeEqual(hash(code), record.code_hash)) { await supabase.from("email_verification_codes").update({ attempts: record.attempts + 1 }).eq("id", record.id); return res.status(400).json({ success: false, message: "Incorrect verification code." }); }
    const now = new Date().toISOString();
    const auth = await supabase.auth.admin.updateUserById(user.id, { email_confirm: true });
    if (auth.error) throw auth.error;
    await supabase.from("email_verification_codes").update({ used_at: now }).eq("id", record.id);
    await supabase.from("users").update({ email_verified_at: now, updated_at: now }).eq("id", user.id);
    await supabase.from("security_events").insert({ user_id: user.id, event_type: "email_verified", severity: "info", metadata: { method: "signup_otp" } });
    return res.json({ success: true, verified: true, message: "Email verified. You can now sign in." });
  } catch (e) { console.error(e); return res.status(500).json({ success: false, message: "Verification service is temporarily unavailable." }); }
});

router.post("/signup/resend", async (req: Request, res: Response) => {
  try {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: "Enter a valid email address." });
    const { data: user } = await supabase.from("users").select("id,email_verified_at").eq("email", email).maybeSingle();
    if (!user || user.email_verified_at) return res.json({ success: true, message: "If the account requires verification, a new code will be sent." });
    const code = await issueCode(user.id, email, "email_verification", CODE_TTL_MS);
    await sendEmail(email, "Verify your VSBIL account", `Your VSBIL verification code is ${code}. It expires in 10 minutes.`, `<h2>Verify your VSBIL account</h2><p>Your verification code is:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>This code expires in 10 minutes. Never share it with anyone.</p>`);
    return res.json({ success: true, message: "Verification code sent." });
  } catch (e: any) { if (e?.message === "COOLDOWN") return res.status(429).json({ success: false, message: "Please wait before requesting another code." }); console.error(e); return res.status(503).json({ success: false, message: "Email delivery is temporarily unavailable." }); }
});

router.post("/magic-link", async (req: Request, res: Response) => {
  try {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: "Enter a valid email address." });
    const { data: authUser } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const user = authUser?.users.find((u) => u.email?.toLowerCase() === email);
    // Do not reveal whether an address is registered.
    if (user) {
      const link = await supabase.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: `${process.env.APP_URL ?? ""}/auth-callback.html` } });
      const action = link.data?.properties?.action_link;
      if (action) await sendEmail(email, "Your VSBIL sign-in link", `Use this one-time sign-in link: ${action}\nIt is intended only for you and may expire.`, `<h2>Sign in to VSBIL</h2><p><a href="${action}">Continue securely</a></p><p>If you did not request this, ignore this email.</p>`);
    }
    return res.json({ success: true, message: "If an account exists for that email, a sign-in link has been sent." });
  } catch (e) { console.error(e); return res.json({ success: true, message: "If an account exists for that email, a sign-in link has been sent." }); }
});

router.post("/password-reset/request", async (req: Request, res: Response) => {
  try {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: "Enter a valid email address." });
    const { data: user } = await supabase.from("users").select("id").eq("email", email).maybeSingle();
    if (user) {
      const code = await issueCode(user.id, email, "password_reset", RESET_TTL_MS);
      await sendEmail(email, "Reset your VSBIL password", `Your password reset code is ${code}. It expires in 15 minutes.`, `<h2>Reset your VSBIL password</h2><p>Your reset code is:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>This code expires in 15 minutes.</p>`);
    }
    return res.json({ success: true, message: "If an account exists for that email, reset instructions have been sent." });
  } catch (e: any) { if (e?.message === "COOLDOWN") return res.status(429).json({ success: false, message: "Please wait before requesting another reset." }); console.error(e); return res.json({ success: true, message: "If an account exists for that email, reset instructions have been sent." }); }
});

router.post("/password-reset/confirm", async (req: Request, res: Response) => {
  try {
    const email = String(req.body?.email ?? "").trim().toLowerCase(); const code = String(req.body?.code ?? "").trim(); const password = String(req.body?.password ?? "");
    if (!/^\d{6}$/.test(code) || password.length < 10 || password.length > 72) return res.status(400).json({ success: false, message: "Enter a valid code and a password of 10–72 characters." });
    const { data: user } = await supabase.from("users").select("id").eq("email", email).maybeSingle();
    if (!user) return res.status(400).json({ success: false, message: "The reset request is invalid or expired." });
    const { data: record } = await latestCode(user.id, "password_reset");
    if (!record || record.attempts >= record.max_attempts || new Date(record.expires_at).getTime() < Date.now() || !safeEqual(hash(code), record.code_hash)) return res.status(400).json({ success: false, message: "The reset code is invalid or expired." });
    const updated = await supabase.auth.admin.updateUserById(user.id, { password }); if (updated.error) throw updated.error;
    const now = new Date().toISOString(); await supabase.from("email_verification_codes").update({ used_at: now }).eq("id", record.id); await supabase.from("security_events").insert({ user_id: user.id, event_type: "password_reset_completed", severity: "medium" });
    return res.json({ success: true, message: "Password changed successfully. Please sign in again." });
  } catch (e) { console.error(e); return res.status(500).json({ success: false, message: "Unable to reset your password right now." }); }
});

router.post("/email-change/request", requireIdentity, async (req: Request, res: Response) => {
  try {
    const email = String(req.body?.email ?? "").trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: "Enter a valid new email address." });
    if (email === req.user!.email.toLowerCase()) return res.status(400).json({ success: false, message: "That is already your email address." });
    const { data: exists } = await supabase.from("users").select("id").eq("email", email).maybeSingle(); if (exists) return res.status(409).json({ success: false, message: "That email address is already in use." });
    const code = await issueCode(req.user!.id, email, "email_change", CODE_TTL_MS);
    await sendEmail(email, "Confirm your new VSBIL email", `Your VSBIL email-change code is ${code}. It expires in 10 minutes.`, `<h2>Confirm your new email</h2><p>Your code is <strong>${code}</strong>.</p><p>This confirms that you control this address.</p>`);
    return res.json({ success: true, message: "A confirmation code was sent to your new email address." });
  } catch (e: any) { if (e?.message === "COOLDOWN") return res.status(429).json({ success: false, message: "Please wait before requesting another code." }); console.error(e); return res.status(503).json({ success: false, message: "Email delivery is temporarily unavailable." }); }
});

router.post("/email-change/confirm", requireIdentity, async (req: Request, res: Response) => {
  try {
    const email = String(req.body?.email ?? "").trim().toLowerCase(); const code = String(req.body?.code ?? "").trim(); if (!/^\d{6}$/.test(code)) return res.status(400).json({ success: false, message: "Enter the 6-digit code." });
    const { data: record } = await latestCode(req.user!.id, "email_change"); if (!record || record.email !== email || record.attempts >= record.max_attempts || new Date(record.expires_at).getTime() < Date.now() || !safeEqual(hash(code), record.code_hash)) return res.status(400).json({ success: false, message: "The confirmation code is invalid or expired." });
    const auth = await supabase.auth.admin.updateUserById(req.user!.id, { email }); if (auth.error) throw auth.error;
    const now = new Date().toISOString(); await supabase.from("users").update({ email, email_verified_at: now, updated_at: now }).eq("id", req.user!.id); await supabase.from("email_verification_codes").update({ used_at: now }).eq("id", record.id); await supabase.from("security_events").insert({ user_id: req.user!.id, event_type: "email_changed", severity: "medium", metadata: { reverified: true } });
    return res.json({ success: true, message: "Your email address has been changed and verified." });
  } catch (e) { console.error(e); return res.status(500).json({ success: false, message: "Unable to change your email right now." }); }
});

router.post("/reauthenticate", requireIdentity, async (req: Request, res: Response) => {
  try {
    const password = String(req.body?.password ?? ""); if (!password) return res.status(400).json({ success: false, message: "Password is required." });
    const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_ANON_KEY; if (!url || !key) return res.status(500).json({ success: false, message: "Authentication is not configured." });
    const r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "Content-Type": "application/json", apikey: key }, body: JSON.stringify({ email: req.user!.email, password }) });
    if (!r.ok) return res.status(401).json({ success: false, message: "Identity verification failed." });
    await supabase.from("security_events").insert({ user_id: req.user!.id, event_type: "reauthenticated", severity: "info" });
    return res.json({ success: true, reauthenticated: true, validForSeconds: 600 });
  } catch (e) { console.error(e); return res.status(500).json({ success: false, message: "Unable to verify your identity." }); }
});

export default router;
