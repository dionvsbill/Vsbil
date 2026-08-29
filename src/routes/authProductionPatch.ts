import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { supabase } from "../config/supabase.js";

const router = Router();
const hash = (value: string) => crypto.createHash("sha256").update(`${value}:${process.env.APP_STATE_SECRET ?? ""}`).digest("hex");

function authConfig() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !key) throw new Error("AUTH_CONFIG_MISSING");
  return { url, key };
}

async function passwordSession(email: string, password: string) {
  const { url, key } = authConfig();
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "Content-Type": "application/json", apikey: key }, body: JSON.stringify({ email, password }) });
  const data: any = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) return null;
  return { accessToken: String(data.access_token), refreshToken: data.refresh_token ? String(data.refresh_token) : null, expiresIn: data.expires_in, expiresAt: data.expires_at, tokenType: data.token_type ?? "bearer" };
}

async function refreshSession(refreshToken: string) {
  const { url, key } = authConfig();
  const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { "Content-Type": "application/json", apikey: key }, body: JSON.stringify({ refresh_token: refreshToken }) });
  const data: any = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) return null;
  return { accessToken: String(data.access_token), refreshToken: data.refresh_token ? String(data.refresh_token) : refreshToken, expiresIn: data.expires_in, expiresAt: data.expires_at, tokenType: data.token_type ?? "bearer" };
}

function publicUser(user: any) {
  return { id: user.id, email: user.email, username: user.username, role: user.role, status: user.status, referralCode: user.referral_code, emailVerifiedAt: user.email_verified_at ?? null };
}

router.post("/login", async (req: Request, res: Response) => {
  try {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length > 72) return res.status(400).json({ success: false, message: "Enter a valid email and password.", code: "INVALID_LOGIN_DETAILS" });
    const session = await passwordSession(email, password);
    if (!session) return res.status(401).json({ success: false, message: "Invalid email or password.", code: "INVALID_CREDENTIALS" });
    const { data: auth, error: authError } = await supabase.auth.getUser(session.accessToken);
    if (authError || !auth.user) return res.status(401).json({ success: false, message: "Your authentication session is invalid.", code: "INVALID_TOKEN" });
    const { data: user, error } = await supabase.from("users").select("id,email,username,role,status,referral_code,email_verified_at").eq("id", auth.user.id).maybeSingle();
    if (error || !user) return res.status(403).json({ success: false, message: "Your VSBIL profile could not be found.", code: "PROFILE_NOT_FOUND" });
    if (String(user.email).toLowerCase() !== String(auth.user.email ?? "").toLowerCase()) return res.status(403).json({ success: false, message: "Your account authentication does not match your VSBIL profile.", code: "EMAIL_MISMATCH" });
    if (!user.email_verified_at) return res.status(403).json({ success: false, message: "Verify your email before signing in.", code: "EMAIL_NOT_VERIFIED", user: publicUser(user) });
    if (["suspended", "banned", "disabled"].includes(String(user.status).toLowerCase())) return res.status(403).json({ success: false, message: "Your account is currently restricted.", code: "ACCOUNT_RESTRICTED" });
    await supabase.from("users").update({ last_login_at: new Date().toISOString(), last_active_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", user.id);
    await supabase.from("security_events").insert({ user_id: user.id, event_type: "login_success", severity: "info", ip_hash: req.ip ? hash(req.ip) : null, metadata: { user_agent: String(req.headers["user-agent"] ?? "") } });
    if (String(user.status).toLowerCase() !== "active") return res.status(403).json({ success: false, message: "Your account needs activation before you can use VSBIL.", code: "ACCOUNT_NOT_ACTIVE", session, user: publicUser(user) });
    return res.json({ success: true, message: "Login successful", session, user: publicUser(user) });
  } catch (error) {
    console.error("production login patch", error);
    return res.status(503).json({ success: false, message: "Authentication service is temporarily unavailable.", code: "AUTH_SERVICE_UNAVAILABLE" });
  }
});

router.post("/refresh", async (req: Request, res: Response) => {
  try {
    const token = String(req.body?.refreshToken ?? "").trim();
    if (!token) return res.status(400).json({ success: false, message: "Refresh token is required.", code: "REFRESH_TOKEN_REQUIRED" });
    const session = await refreshSession(token);
    if (!session) return res.status(401).json({ success: false, message: "Your session has expired. Please sign in again.", code: "REFRESH_FAILED" });
    const { data: auth } = await supabase.auth.getUser(session.accessToken);
    if (!auth.user) return res.status(401).json({ success: false, message: "Your refreshed session is invalid.", code: "INVALID_TOKEN" });
    const { data: user } = await supabase.from("users").select("id,email,username,role,status,referral_code,email_verified_at").eq("id", auth.user.id).maybeSingle();
    if (!user) return res.status(404).json({ success: false, message: "VSBIL profile not found.", code: "PROFILE_NOT_FOUND" });
    if (["suspended", "banned", "disabled"].includes(String(user.status).toLowerCase())) return res.status(403).json({ success: false, message: "Your account is currently restricted.", code: "ACCOUNT_RESTRICTED" });
    return res.json({ success: true, session, user: publicUser(user) });
  } catch (error) {
    console.error("production refresh", error);
    return res.status(401).json({ success: false, message: "Your session could not be refreshed.", code: "REFRESH_FAILED" });
  }
});

export default router;
