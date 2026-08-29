import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { supabase } from "../config/supabase.js";
import { requireIdentity } from "../middleware/authMiddleware.js";
import { randomCode } from "../services/cryptoVault.js";

const router = Router();
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

async function sendEmail(to: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [to], subject: "Your VSBIL verification code", text: `Your VSBIL verification code is ${code}. It expires in 10 minutes. If you did not request this code, ignore this email.`, html: `<p>Your VSBIL verification code is <strong>${code}</strong>.</p><p>This code expires in 10 minutes.</p><p>If you did not request it, you can ignore this email.</p>` }) });
  if (!response.ok) throw new Error(`EMAIL_SEND_FAILED:${response.status}`);
}

function digest(code: string): string { return crypto.createHash("sha256").update(`${code}:${process.env.APP_STATE_SECRET ?? ""}`).digest("hex"); }

router.post("/send", requireIdentity, async (req: Request, res: Response) => {
  try {
    const email = req.user!.email.toLowerCase();
    const { data: latest } = await supabase.from("email_verification_codes").select("created_at").eq("user_id", req.user!.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (latest && Date.now() - new Date(latest.created_at).getTime() < RESEND_COOLDOWN_MS) return res.status(429).json({ success: false, message: "Please wait before requesting another code", code: "VERIFICATION_COOLDOWN" });
    const code = randomCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
    const { error } = await supabase.from("email_verification_codes").insert({ user_id: req.user!.id, code_hash: digest(code), expires_at: expiresAt, attempts: 0 });
    if (error) return res.status(500).json({ success: false, message: "Unable to create verification code" });
    await sendEmail(email, code);
    return res.json({ success: true, message: "Verification code sent" });
  } catch (error) {
    console.error("Verification email", error);
    return res.status(503).json({ success: false, message: "Email verification is temporarily unavailable", code: "EMAIL_SERVICE_UNAVAILABLE" });
  }
});

router.post("/confirm", requireIdentity, async (req: Request, res: Response) => {
  const code = String(req.body?.code ?? "").trim();
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ success: false, message: "Enter the 6-digit verification code" });
  const { data: record, error } = await supabase.from("email_verification_codes").select("id,code_hash,expires_at,attempts,used_at").eq("user_id", req.user!.id).is("used_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !record) return res.status(400).json({ success: false, message: "No active verification code was found" });
  if (record.attempts >= MAX_ATTEMPTS) return res.status(429).json({ success: false, message: "Too many attempts. Request a new code." });
  if (new Date(record.expires_at).getTime() < Date.now()) return res.status(400).json({ success: false, message: "That verification code has expired" });
  const expected = digest(code);
  if (expected !== record.code_hash) {
    await supabase.from("email_verification_codes").update({ attempts: record.attempts + 1 }).eq("id", record.id);
    return res.status(400).json({ success: false, message: "Incorrect verification code" });
  }
  await supabase.from("email_verification_codes").update({ used_at: new Date().toISOString() }).eq("id", record.id);
  await supabase.from("security_events").insert({ user_id: req.user!.id, event_type: "email_verified", severity: "info" });
  return res.json({ success: true, verified: true });
});

export default router;
