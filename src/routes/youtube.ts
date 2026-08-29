import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { supabase } from "../config/supabase.js";
import { requireIdentity } from "../middleware/authMiddleware.js";
import { encryptSecret, hmacState } from "../services/cryptoVault.js";

const router = Router();
const SCOPES = ["https://www.googleapis.com/auth/youtube.readonly"];
const stateLifetimeMs = 10 * 60 * 1000;

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function buildState(userId: string): string {
  const payload = `${userId}.${Date.now()}.${crypto.randomBytes(12).toString("hex")}`;
  return `${Buffer.from(payload).toString("base64url")}.${hmacState(payload)}`;
}

function readState(value: string): string {
  const [payloadPart, signature] = value.split(".");
  if (!payloadPart || !signature) throw new Error("INVALID_STATE");
  const payload = Buffer.from(payloadPart, "base64url").toString("utf8");
  const expected = hmacState(payload);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error("INVALID_STATE");
  const [userId, timestamp] = payload.split(".");
  if (!userId || !timestamp || Date.now() - Number(timestamp) > stateLifetimeMs) throw new Error("EXPIRED_STATE");
  return userId;
}

router.get("/connect", requireIdentity, async (req: Request, res: Response) => {
  try {
    const clientId = env("GOOGLE_CLIENT_ID");
    const redirectUri = env("YOUTUBE_REDIRECT_URI");
    const state = buildState(req.user!.id);
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", access_type: "offline", prompt: "consent", scope: SCOPES.join(" "), state });
    return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  } catch (error) {
    console.error("YouTube connect", error);
    return res.status(503).json({ success: false, message: "YouTube connection is not configured", code: "YOUTUBE_CONFIG_MISSING" });
  }
});

router.get("/callback", async (req: Request, res: Response) => {
  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!code || !state) return res.status(400).send("Invalid YouTube authorization response.");
    const userId = readState(state);
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), redirect_uri: env("YOUTUBE_REDIRECT_URI"), grant_type: "authorization_code" }) });
    const tokens: any = await tokenResponse.json().catch(() => null);
    if (!tokenResponse.ok || !tokens?.access_token) return res.status(502).send("Google authorization could not be completed.");

    const channelResponse = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const channels: any = await channelResponse.json().catch(() => null);
    const channel = channels?.items?.[0];
    if (!channel?.id) return res.status(400).send("No YouTube channel was found on this Google account.");

    const encryptedRefreshToken = tokens.refresh_token ? encryptSecret(String(tokens.refresh_token)) : undefined;
    const row: Record<string, unknown> = { user_id: userId, channel_id: channel.id, channel_title: channel.snippet?.title ?? "", channel_url: `https://www.youtube.com/channel/${channel.id}`, thumbnail_url: channel.snippet?.thumbnails?.default?.url ?? null, status: "connected", scopes: SCOPES, connected_at: new Date().toISOString(), last_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    if (encryptedRefreshToken) row.refresh_token_encrypted = encryptedRefreshToken;
    const { error } = await supabase.from("youtube_connections").upsert(row, { onConflict: "user_id" });
    if (error) throw error;
    await supabase.from("security_events").insert({ user_id: userId, event_type: "youtube_connected", severity: "info", metadata: { channel_id: channel.id } });
    return res.redirect(`${env("APP_URL")}/settings.html?youtube=connected`);
  } catch (error) {
    console.error("YouTube callback", error);
    return res.status(400).send("YouTube connection could not be completed. Please try again.");
  }
});

router.get("/connection", requireIdentity, async (req, res) => {
  const { data, error } = await supabase.from("youtube_connections").select("channel_id,channel_title,channel_url,thumbnail_url,status,connected_at,last_verified_at,updated_at").eq("user_id", req.user!.id).maybeSingle();
  if (error) return res.status(500).json({ success: false, message: "Unable to load YouTube connection" });
  return res.json({ success: true, connected: Boolean(data), connection: data ?? null });
});

router.delete("/connection", requireIdentity, async (req, res) => {
  const { error } = await supabase.from("youtube_connections").update({ status: "revoked", refresh_token_encrypted: null, updated_at: new Date().toISOString() }).eq("user_id", req.user!.id);
  if (error) return res.status(500).json({ success: false, message: "Unable to disconnect YouTube" });
  await supabase.from("security_events").insert({ user_id: req.user!.id, event_type: "youtube_disconnected", severity: "info" });
  return res.json({ success: true });
});

router.post("/verify-subscription", requireIdentity, async (req, res) => {
  const targetChannelId = String(req.body?.channelId ?? "").trim();
  if (!/^UC[a-zA-Z0-9_-]{20,}$/.test(targetChannelId)) return res.status(400).json({ success: false, message: "A valid YouTube channel ID is required" });
  const { data: connection } = await supabase.from("youtube_connections").select("refresh_token_encrypted,status").eq("user_id", req.user!.id).maybeSingle();
  if (!connection?.refresh_token_encrypted || connection.status !== "connected") return res.status(403).json({ success: false, message: "Connect your YouTube account before using subscription verification", code: "YOUTUBE_NOT_CONNECTED" });
  try {
    const refreshToken = (await import("../services/cryptoVault.js")).decryptSecret(connection.refresh_token_encrypted);
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), refresh_token: refreshToken, grant_type: "refresh_token" }) });
    const tokens: any = await tokenResponse.json().catch(() => null);
    if (!tokenResponse.ok || !tokens?.access_token) throw new Error("TOKEN_REFRESH_FAILED");
    const url = new URL("https://www.googleapis.com/youtube/v3/subscriptions");
    url.searchParams.set("part", "snippet"); url.searchParams.set("mine", "true"); url.searchParams.set("forChannelId", targetChannelId); url.searchParams.set("maxResults", "1");
    const check = await fetch(url, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const result: any = await check.json().catch(() => null);
    if (!check.ok) throw new Error("YOUTUBE_API_FAILED");
    const subscribed = Array.isArray(result?.items) && result.items.length > 0;
    await supabase.from("youtube_connections").update({ last_verified_at: new Date().toISOString(), status: "connected", updated_at: new Date().toISOString() }).eq("user_id", req.user!.id);
    return res.json({ success: true, subscribed, checkedAt: new Date().toISOString(), verification: "youtube_api" });
  } catch (error) {
    console.error("Subscription verification", error);
    return res.status(502).json({ success: false, message: "YouTube could not verify the subscription right now", code: "YOUTUBE_VERIFICATION_FAILED" });
  }
});

export default router;
