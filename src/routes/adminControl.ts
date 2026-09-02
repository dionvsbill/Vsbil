import { Router, type Request, type Response } from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth, requireAdmin } from "../middleware/authMiddleware.js";

const router = Router();
router.use(requireAuth, requireAdmin);

const audit = async (adminId: string, action: string, entityType: string, entityId: string | null, metadata: Record<string, unknown> = {}) => {
  await supabase.from("audit_logs").insert({ admin_id: adminId, action, entity_type: entityType, entity_id: entityId, metadata });
};

const stringParam = (value: string | string[] | undefined): string | null => {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
};

const validId = (value: unknown) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);

router.get("/users/:id/intelligence", async (req: Request, res: Response) => {
  const id = stringParam(req.params.id);
  if (!validId(id)) return res.status(400).json({ success: false, message: "Invalid user id" });
  const [user, wallet, payments, referralsOut, referralIn, ledger, withdrawals, submissions, activities, devices, security, participation, notifications, shops, userAudit] = await Promise.all([
    supabase.from("users").select("id,email,username,role,status,referral_code,referred_by,is_verified,verified_at,verified_by,verification_note,email_verified_at,google_verified_at,phone_verified_at,last_login_at,last_active_at,suspended_at,suspension_reason,created_at,updated_at").eq("id", id).maybeSingle(),
    supabase.from("wallets").select("*").eq("user_id", id).maybeSingle(),
    supabase.from("payments").select("id,reference,provider,provider_reference,purpose,amount,amount_ghs,currency,status,created_at,paid_at,verified_at").eq("user_id", id).order("created_at", { ascending: false }).limit(100),
    supabase.from("referrals").select("*").eq("referrer_id", id).order("created_at", { ascending: false }).limit(100),
    supabase.from("referrals").select("*").eq("referred_user_id", id).maybeSingle(),
    supabase.from("wallet_ledger").select("*").eq("user_id", id).order("created_at", { ascending: false }).limit(300),
    supabase.from("withdrawals").select("id,amount,method,status,admin_note,created_at,processed_at").eq("user_id", id).order("created_at", { ascending: false }).limit(100),
    supabase.from("activity_submissions").select("id,activity_id,status,reward_amount,admin_note,created_at,reviewed_at,proof_url,evidence").eq("user_id", id).order("created_at", { ascending: false }).limit(200),
    supabase.from("activities").select("id,title,platform,action,reward_amount,status,created_by,created_at,budget_amount,reserved_amount,spent_amount,max_participants,completed_count,starts_at,ends_at").eq("created_by", id).order("created_at", { ascending: false }).limit(100),
    supabase.from("user_security_devices").select("id,device_hash,ip_hash,user_agent_hash,first_seen_at,last_seen_at,login_count,risk_score,status").eq("user_id", id).order("last_seen_at", { ascending: false }).limit(100),
    supabase.from("account_security_events").select("id,event_type,severity,email_hash,ip_hash,device_hash,user_agent_hash,metadata,created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(300),
    supabase.from("campaign_participation_history").select("id,activity_id,creator_id,platform,channel_id,channel_url,action,status,attempt_id,reward_amount,verified_at,reversed_at,reversal_reason,evidence,ip_hash,device_hash,created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(300),
    supabase.from("notifications").select("id,title,message,read,created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(100),
    supabase.from("business_shops").select("id,user_id,name,phone,address,currency,is_verified,verified_at,verified_by,verification_note,created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(50),
    supabase.from("audit_logs").select("id,admin_id,action,entity_type,entity_id,metadata,created_at").eq("entity_id", id).order("created_at", { ascending: false }).limit(200),
  ]);
  if (user.error || !user.data) return res.status(404).json({ success: false, message: "User not found" });
  const errors = [wallet, payments, referralsOut, referralIn, ledger, withdrawals, submissions, activities, devices, security, participation, notifications, shops, userAudit].filter(x => x.error);
  if (errors.length) console.warn("Some admin intelligence panels could not load", errors.map(x => x.error?.message));
  res.json({ success: true, user: user.data, wallet: wallet.data, payments: payments.data ?? [], referralsOut: referralsOut.data ?? [], referralIn: referralIn.data, ledger: ledger.data ?? [], withdrawals: withdrawals.data ?? [], submissions: submissions.data ?? [], campaigns: activities.data ?? [], devices: devices.data ?? [], securityEvents: security.data ?? [], participation: participation.data ?? [], notifications: notifications.data ?? [], shops: shops.data ?? [], audit: userAudit.data ?? [] });
});

router.patch("/users/:id/verification", async (req: Request, res: Response) => {
  const id = stringParam(req.params.id);
  const verified = Boolean(req.body?.verified);
  const note = String(req.body?.note ?? "").slice(0, 1000);
  if (!validId(id)) return res.status(400).json({ success: false, message: "Invalid user id" });
  const updates = verified ? { is_verified: true, verified_at: new Date().toISOString(), verified_by: req.user!.id, verification_note: note || null } : { is_verified: false, verified_at: null, verified_by: null, verification_note: note || null };
  const { data, error } = await supabase.from("users").update(updates).eq("id", id).select("id,is_verified,verified_at,verified_by,verification_note").maybeSingle();
  if (error || !data) return res.status(404).json({ success: false, message: "User not found" });
  await audit(req.user!.id, verified ? "user_verified" : "user_verification_removed", "user", id, { note });
  res.json({ success: true, verification: data });
});

router.patch("/shops/:id/verification", async (req: Request, res: Response) => {
  const id = stringParam(req.params.id);
  const verified = Boolean(req.body?.verified);
  const note = String(req.body?.note ?? "").slice(0, 1000);
  if (!validId(id)) return res.status(400).json({ success: false, message: "Invalid shop id" });
  const updates = verified ? { is_verified: true, verified_at: new Date().toISOString(), verified_by: req.user!.id, verification_note: note || null } : { is_verified: false, verified_at: null, verified_by: null, verification_note: note || null };
  const { data, error } = await supabase.from("business_shops").update(updates).eq("id", id).select("id,name,user_id,is_verified,verified_at,verified_by,verification_note").maybeSingle();
  if (error || !data) return res.status(404).json({ success: false, message: "Shop not found" });
  await audit(req.user!.id, verified ? "shop_verified" : "shop_verification_removed", "shop", id, { note });
  res.json({ success: true, shop: data });
});

router.get("/verification", async (_req, res) => {
  const [users, shops] = await Promise.all([
    supabase.from("users").select("id,username,email,status,is_verified,verified_at,created_at").order("created_at", { ascending: false }).limit(500),
    supabase.from("business_shops").select("id,name,user_id,is_verified,verified_at,created_at,users(username,email)").order("created_at", { ascending: false }).limit(500),
  ]);
  res.json({ success: true, users: users.data ?? [], shops: shops.data ?? [] });
});

router.get("/feature-flags", async (_req, res) => {
  const { data, error } = await supabase.from("feature_flags").select("key,label,description,enabled,updated_by,updated_at").order("key");
  if (error) return res.status(500).json({ success: false, message: "Unable to load feature flags" });
  res.json({ success: true, flags: data ?? [] });
});

router.patch("/feature-flags/:key", async (req: Request, res: Response) => {
  const key = stringParam(req.params.key) ?? "";
  const enabled = req.body?.enabled;
  if (!/^[a-z0-9_-]{2,50}$/.test(key) || typeof enabled !== "boolean") return res.status(400).json({ success: false, message: "Invalid feature flag update" });
  const { data, error } = await supabase.from("feature_flags").update({ enabled, updated_by: req.user!.id, updated_at: new Date().toISOString() }).eq("key", key).select("*").maybeSingle();
  if (error || !data) return res.status(404).json({ success: false, message: "Feature flag not found" });
  await audit(req.user!.id, "feature_flag_update", "feature_flag", null, { key, enabled });
  res.json({ success: true, flag: data });
});

router.get("/live", async (_req, res) => {
  const [users, payments, withdrawals, submissions, security, shops] = await Promise.all([
    supabase.from("users").select("id,username,email,status,is_verified,created_at,last_active_at").order("created_at", { ascending: false }).limit(20),
    supabase.from("payments").select("id,user_id,amount_ghs,purpose,status,created_at,users(username,email)").order("created_at", { ascending: false }).limit(20),
    supabase.from("withdrawals").select("id,user_id,amount,status,created_at,users(username,email)").order("created_at", { ascending: false }).limit(20),
    supabase.from("activity_submissions").select("id,user_id,activity_id,status,reward_amount,created_at,users(username,email),activities(title,action)").order("created_at", { ascending: false }).limit(20),
    supabase.from("account_security_events").select("id,user_id,event_type,severity,metadata,created_at,users(username,email)").order("created_at", { ascending: false }).limit(20),
    supabase.from("business_shops").select("id,name,user_id,is_verified,created_at,users(username,email)").order("created_at", { ascending: false }).limit(20),
  ]);
  res.json({ success: true, serverTime: new Date().toISOString(), users: users.data ?? [], payments: payments.data ?? [], withdrawals: withdrawals.data ?? [], submissions: submissions.data ?? [], security: security.data ?? [], shops: shops.data ?? [] });
});

export default router;
