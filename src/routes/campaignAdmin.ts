import { Router, type Request } from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth, requireAdmin } from "../middleware/authMiddleware.js";

const router = Router();
router.use(requireAuth, requireAdmin);

async function audit(req: Request, action: string, entityId: string, metadata: Record<string, unknown>) {
  await supabase.from("audit_logs").insert({ admin_id: req.user!.id, action, entity_type: "activity", entity_id: entityId, metadata });
}

router.patch("/activities/:id", async (req, res) => {
  const status = req.body?.status !== undefined ? String(req.body.status) : null;
  const title = req.body?.title !== undefined ? String(req.body.title).trim() : null;
  const rewardGhs = req.body?.rewardGhs !== undefined ? Number(req.body.rewardGhs) : null;
  const note = String(req.body?.note ?? "").trim().slice(0, 1000) || null;
  try {
    if (status && ["active", "paused", "archived", "rejected"].includes(status)) {
      const { data, error } = await supabase.rpc("review_activity", { p_activity_id: req.params.id, p_admin_id: req.user!.id, p_status: status, p_note: note });
      if (error || !data) return res.status(400).json({ success: false, message: error?.message?.includes("CAMPAIGN_UNFUNDED") ? "Campaign cannot be activated until it has funds." : "Unable to review campaign." });
      await audit(req, "campaign_review", req.params.id, { status, note });
      return res.json({ success: true, activity: data });
    }
    const updates: Record<string, unknown> = {};
    if (title !== null) { if (title.length < 3 || title.length > 120) return res.status(400).json({ success: false, message: "Campaign title must be between 3 and 120 characters." }); updates.title = title; }
    if (rewardGhs !== null) { if (!Number.isFinite(rewardGhs) || rewardGhs < 0.1 || rewardGhs > 100) return res.status(400).json({ success: false, message: "Reward must be between ₵0.10 and ₵100.00." }); updates.reward_amount = Math.round(rewardGhs * 100); }
    if (!Object.keys(updates).length) return res.status(400).json({ success: false, message: "No supported campaign changes were supplied." });
    const { data, error } = await supabase.from("activities").update(updates).eq("id", req.params.id).select("*").maybeSingle();
    if (error || !data) return res.status(404).json({ success: false, message: "Campaign not found." });
    await audit(req, "campaign_update", req.params.id, updates);
    return res.json({ success: true, activity: data });
  } catch (error) { console.error("admin campaign", error); return res.status(500).json({ success: false, message: "Unable to update campaign." }); }
});

router.get("/activities/:id/submissions", async (req, res) => {
  const { data, error } = await supabase.from("activity_submissions").select("id,user_id,activity_id,status,reward_amount,proof_url,evidence,created_at,reviewed_at,admin_note,users(username,email)").eq("activity_id", req.params.id).order("created_at", { ascending: false }).limit(500);
  if (error) return res.status(500).json({ success: false, message: "Unable to load campaign submissions." });
  return res.json({ success: true, submissions: data ?? [] });
});

router.get("/risk", async (_req, res) => {
  const { data, error } = await supabase.from("activity_submissions").select("id,user_id,activity_id,status,ip_hash,user_agent_hash,created_at").eq("status", "pending").order("created_at", { ascending: false }).limit(1000);
  if (error) return res.status(500).json({ success: false, message: "Unable to load risk queue." });
  const groups = new Map<string, number>();
  for (const row of data ?? []) if (row.ip_hash) groups.set(row.ip_hash, (groups.get(row.ip_hash) ?? 0) + 1);
  const suspicious = (data ?? []).filter(row => row.ip_hash && (groups.get(row.ip_hash) ?? 0) >= 5).map(row => ({ id: row.id, userId: row.user_id, activityId: row.activity_id, signal: "shared_ip_cluster", createdAt: row.created_at }));
  return res.json({ success: true, pending: data?.length ?? 0, suspicious });
});

export default router;
