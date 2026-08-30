import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { supabase } from "../config/supabase.js";
import { requireAuth, requireIdentity } from "../middleware/authMiddleware.js";
import { decryptSecret, encryptSecret } from "../services/cryptoVault.js";

const router = Router();
const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION?.trim() || "v23.0";
const DEFAULT_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() || "";
const PLAN_GHS: Record<string, number> = { starter: 150, business: 250, pro: 350 };
const MAX_REPLY_LENGTH = 4096;

function clean(value: unknown, max = 255): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function timingSafeHex(a: string, b: string): boolean {
  const aa = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function subscriptionActive(row: any): boolean {
  return row?.status === "active" && (!row.current_period_end || new Date(row.current_period_end).getTime() > Date.now());
}

async function getBotForUser(userId: string) {
  const { data, error } = await supabase.from("whatsapp_bots").select("id,user_id,phone_number_id,display_phone_number,business_name,status,created_at,updated_at").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getActiveSubscription(botId: string) {
  const { data, error } = await supabase.from("whatsapp_subscriptions").select("id,bot_id,plan,status,current_period_start,current_period_end,created_at,updated_at").eq("bot_id", botId).order("current_period_end", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

router.get("/bot", requireIdentity, async (req, res) => {
  try {
    const bot = await getBotForUser(req.user!.id);
    if (!bot) return res.json({ success: true, connected: false, bot: null, subscription: null, flows: [] });
    const subscription = await getActiveSubscription(bot.id);
    const { data: flows, error } = await supabase.from("whatsapp_bot_flows").select("id,keyword,reply_text,is_active,created_at,updated_at").eq("bot_id", bot.id).order("created_at", { ascending: true });
    if (error) throw error;
    return res.json({ success: true, connected: bot.status === "connected", bot, subscription: subscription ? { ...subscription, active: subscriptionActive(subscription) } : null, flows: flows ?? [] });
  } catch (error) {
    console.error("WhatsApp bot load", error);
    return res.status(500).json({ success: false, message: "Unable to load WhatsApp bot" });
  }
});

router.post("/bot", requireAuth, async (req, res) => {
  try {
    const phoneNumberId = clean(req.body?.phoneNumberId, 80);
    const accessToken = clean(req.body?.accessToken, 4096);
    const displayPhoneNumber = clean(req.body?.displayPhoneNumber, 40);
    const businessName = clean(req.body?.businessName, 120);
    if (!/^[0-9]{5,30}$/.test(phoneNumberId)) return res.status(400).json({ success: false, message: "Enter a valid WhatsApp Phone Number ID" });
    if (accessToken.length < 40) return res.status(400).json({ success: false, message: "Enter a valid Meta access token" });
    if (!process.env.APP_ENCRYPTION_KEY) return res.status(503).json({ success: false, message: "Secure token storage is not configured" });

    const { data: conflict } = await supabase.from("whatsapp_bots").select("id,user_id").eq("phone_number_id", phoneNumberId).neq("user_id", req.user!.id).maybeSingle();
    if (conflict) return res.status(409).json({ success: false, message: "That WhatsApp number is already connected to another VSBIL account", code: "PHONE_NUMBER_ALREADY_CONNECTED" });

    const verifyResponse = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const metaData: any = await verifyResponse.json().catch(() => null);
    if (!verifyResponse.ok || !metaData?.id) return res.status(400).json({ success: false, message: metaData?.error?.message || "Meta could not verify this Phone Number ID and access token", code: "META_CREDENTIALS_INVALID" });

    const encrypted = encryptSecret(accessToken);
    const payload = { user_id: req.user!.id, phone_number_id: phoneNumberId, access_token_encrypted: encrypted, display_phone_number: displayPhoneNumber || null, business_name: businessName || metaData.verified_name || null, status: "connected", updated_at: new Date().toISOString() };
    const { data: bot, error } = await supabase.from("whatsapp_bots").upsert(payload, { onConflict: "user_id" }).select("id,user_id,phone_number_id,display_phone_number,business_name,status,created_at,updated_at").single();
    if (error) throw error;
    await supabase.from("security_events").insert({ user_id: req.user!.id, event_type: "whatsapp_bot_connected", severity: "info", metadata: { phone_number_id: phoneNumberId } });
    return res.json({ success: true, message: "WhatsApp Business number connected", bot });
  } catch (error) {
    console.error("WhatsApp bot connect", error);
    return res.status(500).json({ success: false, message: "Unable to connect WhatsApp right now" });
  }
});

router.delete("/bot", requireAuth, async (req, res) => {
  try {
    const bot = await getBotForUser(req.user!.id);
    if (!bot) return res.json({ success: true });
    const { error } = await supabase.from("whatsapp_bots").update({ status: "disconnected", access_token_encrypted: null, updated_at: new Date().toISOString() }).eq("id", bot.id).eq("user_id", req.user!.id);
    if (error) throw error;
    await supabase.from("security_events").insert({ user_id: req.user!.id, event_type: "whatsapp_bot_disconnected", severity: "info", metadata: { bot_id: bot.id } });
    return res.json({ success: true });
  } catch (error) {
    console.error("WhatsApp bot disconnect", error);
    return res.status(500).json({ success: false, message: "Unable to disconnect WhatsApp" });
  }
});

router.post("/flows", requireAuth, async (req, res) => {
  try {
    const bot = await getBotForUser(req.user!.id);
    if (!bot || bot.status !== "connected") return res.status(400).json({ success: false, message: "Connect a WhatsApp number first" });
    const keyword = clean(req.body?.keyword, 100).toLowerCase();
    const replyText = clean(req.body?.replyText, MAX_REPLY_LENGTH);
    if (keyword.length < 1) return res.status(400).json({ success: false, message: "Keyword is required" });
    if (!replyText.length) return res.status(400).json({ success: false, message: "Reply text is required" });
    const { data, error } = await supabase.from("whatsapp_bot_flows").insert({ bot_id: bot.id, keyword, reply_text: replyText, is_active: true }).select("id,keyword,reply_text,is_active,created_at,updated_at").single();
    if (error) return res.status(error.code === "23505" ? 409 : 500).json({ success: false, message: error.code === "23505" ? "That keyword already exists" : "Unable to save auto-reply" });
    return res.status(201).json({ success: true, flow: data });
  } catch (error) {
    console.error("WhatsApp flow create", error);
    return res.status(500).json({ success: false, message: "Unable to save auto-reply" });
  }
});

router.put("/flows/:id", requireAuth, async (req, res) => {
  try {
    const bot = await getBotForUser(req.user!.id);
    const id = clean(req.params.id, 80);
    const keyword = clean(req.body?.keyword, 100).toLowerCase();
    const replyText = clean(req.body?.replyText, MAX_REPLY_LENGTH);
    const isActive = Boolean(req.body?.isActive);
    if (!bot || !id || !keyword || !replyText) return res.status(400).json({ success: false, message: "Invalid auto-reply details" });
    const { data, error } = await supabase.from("whatsapp_bot_flows").update({ keyword, reply_text: replyText, is_active: isActive, updated_at: new Date().toISOString() }).eq("id", id).eq("bot_id", bot.id).select("id,keyword,reply_text,is_active,created_at,updated_at").maybeSingle();
    if (error) return res.status(500).json({ success: false, message: "Unable to update auto-reply" });
    if (!data) return res.status(404).json({ success: false, message: "Auto-reply not found" });
    return res.json({ success: true, flow: data });
  } catch (error) {
    console.error("WhatsApp flow update", error);
    return res.status(500).json({ success: false, message: "Unable to update auto-reply" });
  }
});

router.delete("/flows/:id", requireAuth, async (req, res) => {
  try {
    const bot = await getBotForUser(req.user!.id);
    const id = clean(req.params.id, 80);
    if (!bot) return res.status(404).json({ success: false, message: "Bot not found" });
    const { error } = await supabase.from("whatsapp_bot_flows").delete().eq("id", id).eq("bot_id", bot.id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    console.error("WhatsApp flow delete", error);
    return res.status(500).json({ success: false, message: "Unable to delete auto-reply" });
  }
});

router.get("/messages", requireAuth, async (req, res) => {
  try {
    const bot = await getBotForUser(req.user!.id);
    if (!bot) return res.json({ success: true, messages: [] });
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const { data, error } = await supabase.from("whatsapp_messages").select("id,wa_message_id,sender_phone,incoming_text,matched_keyword,outgoing_text,status,error_message,created_at").eq("bot_id", bot.id).order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return res.json({ success: true, messages: data ?? [] });
  } catch (error) {
    console.error("WhatsApp messages", error);
    return res.status(500).json({ success: false, message: "Unable to load messages" });
  }
});

router.post("/subscription/initialize", requireAuth, async (req, res) => {
  try {
    const bot = await getBotForUser(req.user!.id);
    if (!bot) return res.status(400).json({ success: false, message: "Connect your WhatsApp number before subscribing" });
    const plan = clean(req.body?.plan, 20).toLowerCase();
    const amountGhs = PLAN_GHS[plan];
    if (!amountGhs) return res.status(400).json({ success: false, message: "Invalid WhatsApp plan" });
    const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
    const appUrl = process.env.APP_URL?.trim();
    if (!secret || !appUrl) return res.status(503).json({ success: false, message: "Subscription payment is not configured" });
    const reference = `VSBIL-WA-${Date.now()}-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
    const { error: paymentError } = await supabase.from("whatsapp_subscription_payments").insert({ user_id: req.user!.id, bot_id: bot.id, reference, plan, amount_ghs: amountGhs, status: "pending" });
    if (paymentError) throw paymentError;
    const response = await fetch("https://api.paystack.co/transaction/initialize", { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: req.user!.email, amount: amountGhs * 100, currency: "GHS", reference, callback_url: `${appUrl}/whatsapp-bot.html?payment=verify&reference=${encodeURIComponent(reference)}`, metadata: { user_id: req.user!.id, bot_id: bot.id, purpose: "whatsapp_subscription", plan } }) });
    const data: any = await response.json().catch(() => null);
    if (!response.ok || !data?.status || !data.data?.authorization_url) return res.status(502).json({ success: false, message: "Unable to initialize subscription payment" });
    return res.json({ success: true, authorization_url: data.data.authorization_url, reference, plan, amountGhs });
  } catch (error) {
    console.error("WhatsApp subscription initialize", error);
    return res.status(500).json({ success: false, message: "Unable to initialize subscription" });
  }
});

router.get("/subscription/verify", requireAuth, async (req, res) => {
  try {
    const reference = clean(req.query.reference, 120);
    if (!reference) return res.status(400).json({ success: false, message: "Payment reference is required" });
    const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
    if (!secret) return res.status(503).json({ success: false, message: "Subscription payment is not configured" });
    const { data: payment } = await supabase.from("whatsapp_subscription_payments").select("id,user_id,bot_id,reference,plan,amount_ghs,status").eq("reference", reference).eq("user_id", req.user!.id).maybeSingle();
    if (!payment) return res.status(404).json({ success: false, message: "Subscription payment not found" });
    if (payment.status === "success") return res.json({ success: true, alreadyProcessed: true });
    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${secret}` } });
    const data: any = await response.json().catch(() => null);
    const tx = data?.data;
    if (!response.ok || !data?.status || !tx || tx.status !== "success") return res.status(400).json({ success: false, message: "Payment has not been completed" });
    if (Number(tx.amount) !== Number(payment.amount_ghs) * 100 || String(tx.currency).toUpperCase() !== "GHS" || tx.reference !== payment.reference || tx.metadata?.user_id !== payment.user_id || tx.metadata?.bot_id !== payment.bot_id) return res.status(400).json({ success: false, message: "Payment verification mismatch" });
    const start = new Date();
    const current = await getActiveSubscription(payment.bot_id);
    const base = current && subscriptionActive(current) ? new Date(current.current_period_end) : start;
    const end = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);
    const { error: updateError } = await supabase.from("whatsapp_subscription_payments").update({ status: "success", provider_reference: String(tx.id), paid_at: new Date().toISOString(), verified_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", payment.id).eq("user_id", req.user!.id);
    if (updateError) throw updateError;
    const { error: subscriptionError } = await supabase.from("whatsapp_subscriptions").upsert({ bot_id: payment.bot_id, user_id: payment.user_id, plan: payment.plan, status: "active", current_period_start: current && subscriptionActive(current) ? current.current_period_start : start.toISOString(), current_period_end: end.toISOString(), updated_at: new Date().toISOString() }, { onConflict: "bot_id" });
    if (subscriptionError) throw subscriptionError;
    return res.json({ success: true, plan: payment.plan, currentPeriodEnd: end.toISOString() });
  } catch (error) {
    console.error("WhatsApp subscription verify", error);
    return res.status(500).json({ success: false, message: "Unable to verify subscription" });
  }
});

/* Meta webhook verification uses one application-level verify token. */
router.get("/webhook", async (req, res) => {
  const mode = clean(req.query["hub.mode"], 50);
  const verifyToken = clean(req.query["hub.verify_token"], 4096);
  const challenge = clean(req.query["hub.challenge"], 4096);
  if (mode !== "subscribe" || !DEFAULT_VERIFY_TOKEN || !timingSafeHex(tokenHash(verifyToken), tokenHash(DEFAULT_VERIFY_TOKEN))) return res.sendStatus(403);
  return res.status(200).type("text/plain").send(challenge);
});

function validMetaSignature(req: Request): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
  const signature = clean(req.headers["x-hub-signature-256"], 256);
  const raw = req.rawBody;
  if (!appSecret || !signature || !raw || !signature.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(raw).digest("hex")}`;
  return timingSafeHex(signature, expected);
}

router.post("/webhook", async (req, res) => {
  if (!validMetaSignature(req)) return res.sendStatus(401);
  // Acknowledge quickly; Meta retries when it doesn't receive a 2xx response.
  res.sendStatus(200);
  try {
    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change?.value;
        const phoneNumberId = clean(value?.metadata?.phone_number_id, 80);
        if (!phoneNumberId) continue;
        const messages = Array.isArray(value?.messages) ? value.messages : [];
        if (!messages.length) continue;
        const { data: bot } = await supabase.from("whatsapp_bots").select("id,user_id,phone_number_id,access_token_encrypted,status").eq("phone_number_id", phoneNumberId).eq("status", "connected").maybeSingle();
        if (!bot) continue;
        const subscription = await getActiveSubscription(bot.id);
        if (!subscriptionActive(subscription)) continue;
        const { data: flows } = await supabase.from("whatsapp_bot_flows").select("id,keyword,reply_text").eq("bot_id", bot.id).eq("is_active", true);
        for (const message of messages) {
          const waMessageId = clean(message?.id, 200);
          if (!waMessageId) continue;
          const { data: seen } = await supabase.from("whatsapp_messages").select("id").eq("bot_id", bot.id).eq("wa_message_id", waMessageId).maybeSingle();
          if (seen) continue;
          const incoming = message?.type === "text" ? clean(message?.text?.body, 4096) : "";
          const sender = clean(message?.from, 40);
          if (!sender || !incoming) {
            await supabase.from("whatsapp_messages").insert({ bot_id: bot.id, wa_message_id: waMessageId, sender_phone: sender || "unknown", incoming_text: incoming || `[${clean(message?.type, 40) || "unsupported"}]`, status: "ignored" });
            continue;
          }
          const normalized = incoming.toLowerCase();
          const match = (flows ?? []).find((flow: any) => normalized === String(flow.keyword).toLowerCase() || normalized.includes(String(flow.keyword).toLowerCase()));
          if (!match) {
            await supabase.from("whatsapp_messages").insert({ bot_id: bot.id, wa_message_id: waMessageId, sender_phone: sender, incoming_text: incoming, status: "no_match" });
            continue;
          }
          let outgoing = String(match.reply_text).slice(0, MAX_REPLY_LENGTH);
          let status = "sent";
          let errorMessage: string | null = null;
          try {
            const accessToken = decryptSecret(bot.access_token_encrypted);
            const sendResponse = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: sender, type: "text", text: { preview_url: false, body: outgoing } }) });
            const sendData: any = await sendResponse.json().catch(() => null);
            if (!sendResponse.ok) { status = "failed"; errorMessage = sendData?.error?.message || "Meta message delivery failed"; }
          } catch (error) { status = "failed"; errorMessage = error instanceof Error ? error.message : "Unable to send message"; }
          await supabase.from("whatsapp_messages").insert({ bot_id: bot.id, wa_message_id: waMessageId, sender_phone: sender, incoming_text: incoming, matched_keyword: match.keyword, outgoing_text: status === "sent" ? outgoing : null, status, error_message: errorMessage });
        }
      }
    }
  } catch (error) {
    console.error("WhatsApp webhook processing", error);
  }
});

export default router;
