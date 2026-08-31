import { Router, type Request, type Response } from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;

  try {
    const [walletResult, referralResult, submissionResult, notificationResult, ledgerResult, completedResult, campaignResult, shopResult] = await Promise.all([
      supabase
        .from("wallets")
        .select("available,pending,total_earned,lifetime_withdrawn")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("referrals")
        .select("id,new_user_bonus_coins,referrer_bonus_coins,bonus_amount,status,created_at,referred_user_id,qualified_at")
        .eq("referrer_id", userId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("activity_submissions")
        .select("id,status,reward_amount,created_at,activities(title,platform)")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("notifications")
        .select("id,title,message,read,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("wallet_ledger")
        .select("amount")
        .eq("user_id", userId)
        .eq("entry_type", "earning")
        .gte("created_at", new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString()),
      supabase
        .from("activity_submissions")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "approved"),
      supabase
        .from("campaigns")
        .select("id,status,budget,total_budget,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("business_shops")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
    ]);

    const firstError = [
      walletResult,
      referralResult,
      submissionResult,
      notificationResult,
      ledgerResult,
      completedResult,
      campaignResult,
      shopResult,
    ].find((result) => result.error)?.error;

    if (firstError) {
      console.error("Dashboard data error", firstError);
      return res.status(500).json({
        success: false,
        message: "Unable to load dashboard",
        code: "DASHBOARD_ERROR",
      });
    }

    const wallet = walletResult.data;
    const referralRows = referralResult.data ?? [];
    const submissions = submissionResult.data ?? [];
    const notifications = notificationResult.data ?? [];
    const campaigns = campaignResult.data ?? [];

    const todayEarnings = (ledgerResult.data ?? []).reduce(
      (sum, row) => sum + Number(row.amount || 0),
      0,
    );

    const referralEarnings = referralRows
      .filter((row) => row.status === "credited")
      .reduce(
        (sum, row) =>
          sum + Number(row.referrer_bonus_coins ?? row.bonus_amount ?? 0),
        0,
      );

    const campaignSummary = {
      total: campaigns.length,
      active: campaigns.filter((campaign) => campaign.status === "active").length,
      completed: campaigns.filter((campaign) =>
        ["completed", "closed", "ended"].includes(String(campaign.status)),
      ).length,
    };

    return res.json({
      success: true,
      wallet: {
        available: wallet?.available ?? 0,
        pending: wallet?.pending ?? 0,
        totalEarned: wallet?.total_earned ?? 0,
        lifetimeWithdrawn: wallet?.lifetime_withdrawn ?? 0,
      },
      referrals: {
        count: referralRows.length,
        earnings: referralEarnings,
        items: referralRows,
      },
      activity: {
        todayEarnings,
        completed: completedResult.data?.length ?? 0,
        recent: submissions,
      },
      campaigns: campaignSummary,
      business: {
        shops: shopResult.count ?? 0,
      },
      notifications,
    });
  } catch (error) {
    console.error("Dashboard error", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load dashboard",
      code: "DASHBOARD_ERROR",
    });
  }
});

export default router;
