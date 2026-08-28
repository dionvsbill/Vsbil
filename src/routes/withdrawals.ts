import { Router, type Request, type Response } from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = Router();
const MIN_WITHDRAWAL = Number(process.env.MIN_WITHDRAWAL_GHS || 10);

router.get("/", requireAuth, async (req: Request, res: Response) => {
  const { data, error } = await supabase.from("withdrawals").select("id,amount,method,account_details,status,admin_note,created_at,processed_at").eq("user_id", req.user!.id).order("created_at", { ascending: false }).limit(100);
  if (error) return res.status(500).json({ success: false, message: "Unable to load withdrawals" });
  return res.json({ success: true, withdrawals: data ?? [] });
});

router.post("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const amount = Number(req.body?.amount);
    const method = String(req.body?.method || "");
    const details = req.body?.accountDetails;
    if (!Number.isFinite(amount) || amount < MIN_WITHDRAWAL || amount > 100000) return res.status(400).json({ success: false, message: `Withdrawal must be at least ₵${MIN_WITHDRAWAL.toFixed(2)}.` });
    if (!['mobile_money','bank'].includes(method)) return res.status(400).json({ success: false, message: "Invalid withdrawal method." });
    if (!details || typeof details !== "object") return res.status(400).json({ success: false, message: "Withdrawal account details are required." });
    if (method === 'mobile_money' && !/^\+?[0-9]{10,15}$/.test(String(details.phone || "").replace(/\s/g, ""))) return res.status(400).json({ success: false, message: "Enter a valid mobile money phone number." });
    if (method === 'bank' && !/^[0-9]{6,20}$/.test(String(details.account_number || ""))) return res.status(400).json({ success: false, message: "Enter a valid bank account number." });
    const { data, error } = await supabase.rpc("request_withdrawal", { p_user_id: req.user!.id, p_amount: Math.round(amount * 100), p_method: method, p_account_details: details });
    if (error) { console.error("Withdrawal RPC", error); return res.status(400).json({ success: false, message: error.message.includes("INSUFFICIENT") ? "Insufficient available balance." : "Unable to submit withdrawal." }); }
    return res.status(201).json({ success: true, withdrawal: data });
  } catch (error) {
    console.error("Withdrawal error", error);
    return res.status(500).json({ success: false, message: "Unable to submit withdrawal." });
  }
});
export default router;
