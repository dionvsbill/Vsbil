import { Router, type Request, type Response } from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth, requireAdmin } from "../middleware/authMiddleware.js";

const router = Router();
router.use(requireAuth, requireAdmin);

router.get("/overview", async (_req, res) => {
  try {
    const [{ count: users }, { count: active }, { count: pendingPayments }, { count: pendingWithdrawals }, { data: platform }] = await Promise.all([
      supabase.from("users").select("id", { count: "exact", head: true }),
      supabase.from("users").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("payments").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("withdrawals").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("platform_wallet").select("balance").eq("id", 1).maybeSingle(),
    ]);
    return res.json({ success: true, stats: { users: users ?? 0, activeUsers: active ?? 0, pendingPayments: pendingPayments ?? 0, pendingWithdrawals: pendingWithdrawals ?? 0, platformBalance: platform?.balance ?? 0 } });
  } catch (e) { console.error(e); return res.status(500).json({ success: false, message: "Unable to load admin overview" }); }
});

router.get("/users", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const search = String(req.query.search || "").trim();
  let query = supabase.from("users").select("id,email,username,role,status,referral_code,referred_by,created_at,updated_at").order("created_at", { ascending: false }).limit(limit);
  if (search) query = query.or(`email.ilike.%${search}%,username.ilike.%${search}%`);
  const { data, error } = await query;
  if (error) return res.status(500).json({ success: false, message: "Unable to load users" });
  return res.json({ success: true, users: data ?? [] });
});

router.patch("/users/:id/status", async (req, res) => {
  const status = String(req.body?.status || "");
  if (!['pending','active','suspended','banned'].includes(status)) return res.status(400).json({ success: false, message: "Invalid status" });
  const { data, error } = await supabase.from("users").update({ status, updated_at: new Date().toISOString() }).eq("id", req.params.id).select("id,status").maybeSingle();
  if (error || !data) return res.status(400).json({ success: false, message: "Unable to update user" });
  await supabase.from("audit_logs").insert({ admin_id: req.user!.id, action: "user_status_change", entity_type: "user", entity_id: req.params.id, metadata: { status } });
  return res.json({ success: true, user: data });
});

router.get("/payments", async (_req, res) => {
  const { data, error } = await supabase.from("payments").select("id,user_id,reference,amount_ghs,currency,purpose,status,provider_reference,created_at,paid_at,users(username,email)").order("created_at", { ascending: false }).limit(200);
  if (error) return res.status(500).json({ success: false, message: "Unable to load payments" });
  return res.json({ success: true, payments: data ?? [] });
});

router.get("/withdrawals", async (_req, res) => {
  const { data, error } = await supabase.from("withdrawals").select("id,user_id,amount,method,account_details,status,admin_note,created_at,processed_at,users(username,email)").order("created_at", { ascending: false }).limit(200);
  if (error) return res.status(500).json({ success: false, message: "Unable to load withdrawals" });
  return res.json({ success: true, withdrawals: data ?? [] });
});

router.patch("/withdrawals/:id", async (req, res) => {
  const status = String(req.body?.status || "");
  const note = String(req.body?.note || "").slice(0, 1000);
  if (!['approved','rejected','paid'].includes(status)) return res.status(400).json({ success: false, message: "Invalid withdrawal status" });
  const { data: current, error: readError } = await supabase.from("withdrawals").select("id,status,user_id,amount").eq("id", req.params.id).maybeSingle();
  if (readError || !current) return res.status(404).json({ success: false, message: "Withdrawal not found" });
  if (current.status === 'paid' || current.status === 'rejected') return res.status(409).json({ success: false, message: "Withdrawal is already finalized" });
  const { data, error } = await supabase.from("withdrawals").update({ status, admin_note: note || null, processed_at: ['paid','rejected'].includes(status) ? new Date().toISOString() : null }).eq("id", req.params.id).select("*").single();
  if (error) return res.status(400).json({ success: false, message: "Unable to update withdrawal" });
  if (status === 'rejected') await supabase.rpc("refund_withdrawal", { p_withdrawal_id: current.id });
  await supabase.from("audit_logs").insert({ admin_id: req.user!.id, action: `withdrawal_${status}`, entity_type: "withdrawal", entity_id: current.id, metadata: { note } });
  return res.json({ success: true, withdrawal: data });
});

router.get("/activities", async (_req, res) => {
  const { data, error } = await supabase.from("activities").select("*").order("created_at", { ascending: false }).limit(200);
  if (error) return res.status(500).json({ success: false, message: "Unable to load activities" });
  return res.json({ success: true, activities: data ?? [] });
});

router.post("/activities", async (req, res) => {
  const title = String(req.body?.title || "").trim().slice(0, 150);
  const platform = String(req.body?.platform || "youtube");
  const url = String(req.body?.url || "").trim().slice(0, 500);
  const action = String(req.body?.action || "watch");
  const reward = Number(req.body?.reward || 0);
  if (!title || !/^https?:\/\//i.test(url) || !['youtube'].includes(platform) || !['watch','like','subscribe'].includes(action) || !Number.isFinite(reward) || reward <= 0 || reward > 1000) return res.status(400).json({ success: false, message: "Invalid activity details" });
  const { data, error } = await supabase.from("activities").insert({ title, platform, url, action, reward_amount: Math.round(reward * 100), status: "active", created_by: req.user!.id }).select("*").single();
  if (error) return res.status(400).json({ success: false, message: "Unable to create activity" });
  await supabase.from("audit_logs").insert({ admin_id: req.user!.id, action: "activity_create", entity_type: "activity", entity_id: data.id, metadata: { title } });
  return res.status(201).json({ success: true, activity: data });
});

router.get("/submissions", async (_req, res) => {
  const { data, error } = await supabase.from("activity_submissions").select("id,user_id,activity_id,proof_url,status,reward_amount,admin_note,created_at,reviewed_at,users(username,email),activities(title,action,url)").order("created_at", { ascending: false }).limit(300);
  if (error) return res.status(500).json({ success: false, message: "Unable to load submissions" });
  return res.json({ success: true, submissions: data ?? [] });
});

router.patch("/submissions/:id", async (req, res) => {
  const status = String(req.body?.status || "");
  const note = String(req.body?.note || "").slice(0, 1000);
  if (!['approved','rejected'].includes(status)) return res.status(400).json({ success: false, message: "Invalid review status" });
  const { data: submission } = await supabase.from("activity_submissions").select("id,status").eq("id", req.params.id).maybeSingle();
  if (!submission) return res.status(404).json({ success: false, message: "Submission not found" });
  if (submission.status !== 'pending') return res.status(409).json({ success: false, message: "Submission has already been reviewed" });
  const { data, error } = await supabase.rpc("review_submission", { p_submission_id: submission.id, p_status: status, p_admin_id: req.user!.id, p_note: note || null });
  if (error) return res.status(400).json({ success: false, message: error.message });
  return res.json({ success: true, submission: data });
});

router.get("/audit-logs", async (_req, res) => {
  const { data, error } = await supabase.from("audit_logs").select("id,admin_id,action,entity_type,entity_id,metadata,created_at").order("created_at", { ascending: false }).limit(300);
  if (error) return res.status(500).json({ success: false, message: "Unable to load audit logs" });
  return res.json({ success: true, logs: data ?? [] });
});

export default router;
