import { Router, type Request, type Response } from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = Router();
function configuredNumber(name: string, fallback: number) { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : fallback; }
function sanitizeDetails(method: string, details: any) { if (method === "mobile_money") return { phone: String(details?.phone ?? "").replace(/\s/g, "").slice(0, 20), provider: String(details?.provider ?? "").trim().slice(0, 40) }; return { bank_name: String(details?.bank_name ?? "").trim().slice(0, 120), account_number: String(details?.account_number ?? "").replace(/\s/g, "").slice(0, 30), account_name: String(details?.account_name ?? "").trim().slice(0, 120) }; }

router.get("/", requireAuth, async (req, res) => {
  const { data, error } = await supabase.from("withdrawals").select("id,amount,method,account_details,status,admin_note,created_at,processed_at").eq("user_id", req.user!.id).order("created_at", { ascending: false }).limit(100);
  if (error) return res.status(500).json({ success: false, message: "Unable to load withdrawals" });
  return res.json({ success: true, withdrawals: data ?? [] });
});

router.post("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const min = configuredNumber("MIN_WITHDRAWAL_GHS", 20), max = configuredNumber("MAX_WITHDRAWAL_GHS", 5000);
    const amount = Number(req.body?.amount), method = String(req.body?.method ?? "").trim(), details = sanitizeDetails(method, req.body?.accountDetails);
    const idempotencyKey = String(req.headers["x-idempotency-key"] ?? "").trim();
    if (!Number.isFinite(amount) || amount < min || amount > max) return res.status(400).json({ success: false, message: `Withdrawal must be between ₵${min.toFixed(2)} and ₵${max.toFixed(2)}.` });
    if (!["mobile_money", "bank"].includes(method)) return res.status(400).json({ success: false, message: "Select a valid withdrawal method." });
    if (method === "mobile_money" && !/^\+?[0-9]{10,15}$/.test(details.phone)) return res.status(400).json({ success: false, message: "Enter a valid mobile money number." });
    if (method === "bank" && (!/^[0-9]{6,30}$/.test(details.account_number) || details.bank_name.length < 2 || details.account_name.length < 2)) return res.status(400).json({ success: false, message: "Enter a valid bank, account name and account number." });
    if (idempotencyKey && !/^[A-Za-z0-9._:-]{8,120}$/.test(idempotencyKey)) return res.status(400).json({ success: false, message: "Invalid idempotency key." });
    if (idempotencyKey) { const { data: prior } = await supabase.from("idempotency_keys").select("response").eq("user_id", req.user!.id).eq("key", idempotencyKey).eq("route", "withdrawal_create").maybeSingle(); if (prior?.response) return res.status(200).json(prior.response); }

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await supabase.from("withdrawals").select("amount,status").eq("user_id", req.user!.id).gte("created_at", since).not("status", "eq", "rejected");
    const weeklyMax = configuredNumber("WEEKLY_WITHDRAWAL_MAX_GHS", 5000) * 100;
    const used = (recent ?? []).reduce((sum, row) => sum + Number(row.amount || 0), 0), requestedMinor = Math.round(amount * 100);
    if (used + requestedMinor > weeklyMax) return res.status(429).json({ success: false, message: "This withdrawal would exceed your weekly payout limit. Please try again later." });

    const { data, error } = await supabase.rpc("request_withdrawal", { p_user_id: req.user!.id, p_amount: requestedMinor, p_method: method, p_account_details: details });
    if (error) { const m = error.message; return res.status(400).json({ success: false, message: m.includes("INSUFFICIENT") ? "Insufficient available balance." : m.includes("PENDING_WITHDRAWAL") ? "You already have a pending withdrawal." : "Unable to submit withdrawal." }); }
    const response = { success: true, message: "Withdrawal submitted for review.", withdrawal: data };
    if (idempotencyKey) await supabase.from("idempotency_keys").insert({ user_id: req.user!.id, key: idempotencyKey, route: "withdrawal_create", response }).catch(() => undefined);
    await supabase.from("security_events").insert({ user_id: req.user!.id, event_type: "withdrawal_requested", severity: "info", metadata: { amount: requestedMinor, method } });
    return res.status(201).json(response);
  } catch (error) { console.error("withdrawal request", error); return res.status(500).json({ success: false, message: "Unable to submit withdrawal." }); }
});

export default router;
