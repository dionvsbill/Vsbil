import { Router, type Request, type Response } from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const [{ data: wallet }, { data: referrals }, { data: submissions }, { data: notifications }] = await Promise.all([
      supabase.from("wallets").select("available,pending,total_earned,lifetime_withdrawn").eq("user_id", userId).maybeSingle(),
      supabase.from("referrals").select("id,bonus_amount,status,created_at").eq("referrer_id", userId).order("created_at", { ascending: false }).limit(100),
      supabase.from("activity_submissions").select("id,status,reward_amount,created_at,activities(title,platform)").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
      supabase.from("notifications").select("id,title,message,read,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
    ]);
    const [{ data: todayLedger }, { data: allCompleted }] = await Promise.all([
      supabase.from("wallet_ledger").select("amount").eq("user_id", userId).eq("entry_type", "earning").gte("created_at", new Date(new Date().setUTCHours(0,0,0,0)).toISOString()),
      supabase.from("activity_submissions").select("id").eq("user_id", userId).eq("status", "approved"),
    ]);
    const referralRows = referrals ?? [];
    const completed = allCompleted?.length ?? 0;
    const todayEarnings = (todayLedger ?? []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const referralEarnings = referralRows.filter(r => r.status === "credited").reduce((sum, r) => sum + Number(r.bonus_amount || 0), 0);
    res.json({
      success: true,
      wallet: { available: wallet?.available ?? 0, pending: wallet?.pending ?? 0, totalEarned: wallet?.total_earned ?? 0, lifetimeWithdrawn: wallet?.lifetime_withdrawn ?? 0 },
      referrals: { count: referralRows.length, earnings: referralEarnings, items: referralRows },
      activity: { todayEarnings, completed, recent: submissions ?? [] },
      notifications: notifications ?? [],
    });
  } catch (error) {
    console.error("Dashboard error", error);
    res.status(500).json({ success: false, message: "Unable to load dashboard", code: "DASHBOARD_ERROR" });
  }
});

export default router;
