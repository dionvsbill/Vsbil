import { Router, type Request } from "express";
import crypto from "node:crypto";
import { supabase } from "../config/supabase.js";

const router = Router();
const categories = new Set(["general","account","payment","campaign","wallet","withdrawal","privacy","other","safety","campaign_report","impersonation","harassment","account_compromise","reward_dispute","security"]);
const clean = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function token(req: Request) { const value = req.headers.authorization; return typeof value === "string" && value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : null; }

router.post("/tickets", async (req, res) => {
  try {
    if (clean(req.body?.website, 100)) return res.status(400).json({ success: false, message: "Unable to submit request" });
    const name = clean(req.body?.name, 80), email = clean(req.body?.email, 254).toLowerCase(), category = clean(req.body?.category, 40), message = clean(req.body?.message, 5000), reference = clean(req.body?.reference, 120) || null;
    if (name.length < 2 || !emailRe.test(email) || !categories.has(category) || message.length < 10) return res.status(400).json({ success: false, message: "Please provide a valid name, email, topic and a clear message." });
    let userId: string | null = null;
    const bearer = token(req);
    if (bearer) { const { data } = await supabase.auth.getUser(bearer); userId = data.user?.id ?? null; }
    const ticketRef = `VSB-${new Date().getUTCFullYear()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
    const { data, error } = await supabase.from("support_tickets").insert({ reference: ticketRef, user_id: userId, name, email, category, reference_value: reference, message, status: "open" }).select("id,reference,status,created_at").single();
    if (error) { console.error("Support ticket insert", error); return res.status(500).json({ success: false, message: "We could not record your request. Please try again." }); }
    if (userId) await supabase.from("security_events").insert({ user_id: userId, event_type: "support_ticket_created", severity: "info", metadata: { ticket_id: data.id, category } });
    return res.status(201).json({ success: true, ticket: data });
  } catch (error) { console.error("Support ticket", error); return res.status(500).json({ success: false, message: "We could not record your request. Please try again." }); }
});

export default router;
