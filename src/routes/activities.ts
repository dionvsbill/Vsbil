import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = Router();
router.use(requireAuth);

const TITLE_MIN = 3;
const TITLE_MAX = 150;

const moneyToMinor = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const validYoutubeUrl = (value: string): boolean => /^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(value);
const hash = (value: string): string => crypto.createHash("sha256").update(`${value}:${process.env.APP_STATE_SECRET ?? ""}`).digest("hex");
const ipHash = (req: Request): string => hash(String(req.ip ?? "unknown"));
const uaHash = (req: Request): string => hash(String(req.headers["user-agent"] ?? "unknown"));

function errorMessage(error: unknown): string {
  const m = error instanceof Error ? error.message : String(error ?? "");
  const known: Record<string, string> = {
    INSUFFICIENT_FUNDS: "You do not have enough available balance to fund this campaign.",
    WALLET_NOT_FOUND: "Your wallet is not ready yet. Please try again later.",
    BUDGET_BELOW_PARTICIPANTS: "Campaign budget must cover the maximum participant count at the selected reward.",
    INVALID_CAMPAIGN: "Check the campaign details and try again.",
    INVALID_SCHEDULE: "Check the campaign start and end times.",
    CAMPAIGN_UNAVAILABLE: "This campaign is no longer available.",
    OWNER_CANNOT_PARTICIPATE: "You cannot complete your own campaign.",
    CAMPAIGN_NOT_STARTED: "This campaign has not started yet.",
    CAMPAIGN_ENDED: "This campaign has ended.",
    CAMPAIGN_FULL: "This campaign has reached its participant limit.",
    ALREADY_SUBMITTED: "You have already submitted this campaign.",
    ATTEMPT_NOT_FOUND: "The activity attempt could not be found.",
    ATTEMPT_EXPIRED: "Your activity session expired. Please start again.",
    ATTEMPT_CONSUMED: "This activity attempt has already been used.",
    MINIMUM_TIME_NOT_MET: "Please complete the required viewing time before submitting.",
  };
  return known[m] ?? "Unable to complete the activity request.";
}

router.get("/", async (_req, res) => {
  const { data, error } = await supabase.from("activities").select("id,title,platform,url,action,reward_amount,budget_amount,reserved_amount,spent_amount,max_participants,completed_count,status,starts_at,ends_at,minimum_seconds,requires_youtube_connection,created_by,created_at").eq("status", "active").order("created_at", { ascending: false }).limit(100);
  if (error) return res.status(500).json({ success: false, message: "Unable to load campaigns" });
  return res.json({ success: true, activities: data ?? [] });
});

router.get("/mine", async (req, res) => {
  const { data, error } = await supabase.from("activities").select("id,title,platform,url,action,reward_amount,budget_amount,reserved_amount,spent_amount,max_participants,completed_count,status,starts_at,ends_at,minimum_seconds,requires_youtube_connection,review_note,approved_at,created_at").eq("created_by", req.user!.id).order("created_at", { ascending: false }).limit(200);
  if (error) return res.status(500).json({ success: false, message: "Unable to load your campaigns" });
  return res.json({ success: true, activities: data ?? [] });
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const title = String(req.body?.title ?? "").trim();
    const platform = String(req.body?.platform ?? "youtube").trim().toLowerCase();
    const url = String(req.body?.url ?? "").trim();
    const action = String(req.body?.action ?? "watch").trim().toLowerCase();
    const reward = moneyToMinor(req.body?.rewardGhs);
    const budget = moneyToMinor(req.body?.budgetGhs);
    const maxParticipants = Number(req.body?.maxParticipants);
    const minimumSeconds = Number(req.body?.minimumSeconds ?? 30);
    const startsAt = req.body?.startsAt ? new Date(String(req.body.startsAt)).toISOString() : null;
    const endsAt = req.body?.endsAt ? new Date(String(req.body.endsAt)).toISOString() : null;

    if (title.length < TITLE_MIN || title.length > TITLE_MAX) {
      return res.status(400).json({ success: false, code: "INVALID_CAMPAIGN_TITLE", message: `Campaign title must be between ${TITLE_MIN} and ${TITLE_MAX} characters.` });
    }
    if (platform !== "youtube" || !validYoutubeUrl(url)) return res.status(400).json({ success: false, message: "Enter a valid YouTube campaign URL." });
    if (action !== "watch") return res.status(403).json({ success: false, message: "Only compliant viewing campaigns are currently supported." });
    if (!Number.isInteger(reward) || reward < 10 || reward > 10000) return res.status(400).json({ success: false, message: "Reward must be between ₵0.10 and ₵100.00." });
    if (!Number.isInteger(budget) || budget < 500 || budget > 10000000) return res.status(400).json({ success: false, message: "Campaign budget must be between ₵5.00 and ₵100,000.00." });
    if (!Number.isInteger(maxParticipants) || maxParticipants < 1 || maxParticipants > 1000000) return res.status(400).json({ success: false, message: "Participant limit must be between 1 and 1,000,000." });
    if (budget < reward * maxParticipants) return res.status(400).json({ success: false, message: "Budget must cover the maximum participant count at the selected reward." });
    if (!Number.isInteger(minimumSeconds) || minimumSeconds < 5 || minimumSeconds > 3600) return res.status(400).json({ success: false, message: "Viewing time must be between 5 seconds and 60 minutes." });
    if (startsAt && Number.isNaN(Date.parse(startsAt))) return res.status(400).json({ success: false, message: "Invalid start time." });
    if (endsAt && Number.isNaN(Date.parse(endsAt))) return res.status(400).json({ success: false, message: "Invalid end time." });

    const idempotencyKey = String(req.headers["x-idempotency-key"] ?? "").trim();
    if (idempotencyKey && !/^[A-Za-z0-9._:-]{8,120}$/.test(idempotencyKey)) return res.status(400).json({ success: false, message: "Invalid request key." });
    if (idempotencyKey) {
      const { data: prior } = await supabase.from("idempotency_keys").select("response").eq("user_id", req.user!.id).eq("key", idempotencyKey).eq("route", "campaign_create").maybeSingle();
      if (prior?.response) return res.status(200).json(prior.response);
    }

    const { data, error } = await supabase.rpc("create_funded_activity", {
      p_user_id: req.user!.id,
      p_title: title,
      p_platform: platform,
      p_url: url,
      p_action: action,
      p_reward_amount: reward,
      p_budget_amount: budget,
      p_max_participants: maxParticipants,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_requires_youtube_connection: false,
      p_minimum_seconds: minimumSeconds,
    });
    if (error || !data) {
      console.error("create campaign", error);
      return res.status(400).json({ success: false, message: errorMessage(error) });
    }

    const response = { success: true, message: "Campaign submitted for review. Your budget is reserved while it is reviewed.", campaign: data };
    if (idempotencyKey) await supabase.from("idempotency_keys").insert({ user_id: req.user!.id, key: idempotencyKey, route: "campaign_create", response });
    return res.status(201).json(response);
  } catch (error) {
    console.error("Create campaign", error);
    return res.status(500).json({ success: false, message: "Unable to create campaign right now." });
  }
});

router.post("/:id/start", async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase.rpc("start_activity_attempt", { p_user_id: req.user!.id, p_activity_id: req.params.id, p_ip_hash: ipHash(req), p_user_agent_hash: uaHash(req) });
    if (error || !data) return res.status(400).json({ success: false, message: errorMessage(error) });
    return res.status(201).json({ success: true, attempt: { id: data.id, startedAt: data.started_at, expiresAt: data.expires_at }, activity: { id: req.params.id } });
  } catch (error) {
    console.error("Start activity", error);
    return res.status(500).json({ success: false, message: "Unable to start this activity." });
  }
});

router.post("/:id/complete", async (req: Request, res: Response) => {
  try {
    const attemptId = String(req.body?.attemptId ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(attemptId)) return res.status(400).json({ success: false, message: "A valid activity attempt is required." });
    const evidence = req.body?.evidence && typeof req.body.evidence === "object" ? req.body.evidence : {};
    const { data, error } = await supabase.rpc("complete_activity_attempt", { p_attempt_id: attemptId, p_user_id: req.user!.id, p_evidence: evidence, p_ip_hash: ipHash(req), p_user_agent_hash: uaHash(req) });
    if (error || !data) return res.status(400).json({ success: false, message: errorMessage(error) });
    return res.status(201).json({ success: true, message: "Activity submitted for verification.", submission: { id: data.id, status: data.status, rewardAmount: data.reward_amount } });
  } catch (error) {
    console.error("Complete activity", error);
    return res.status(500).json({ success: false, message: "Unable to submit this activity." });
  }
});

router.post("/:id/submit", async (_req, res) => res.status(410).json({ success: false, message: "Direct submissions are disabled. Start the activity first." }));

router.patch("/:id", async (req: Request, res: Response) => {
  if (req.body?.status === "archived") {
    const { data: activity, error: loadError } = await supabase.from("activities").select("id,created_by").eq("id", req.params.id).maybeSingle();
    if (loadError || !activity) return res.status(404).json({ success: false, message: "Campaign not found." });
    if (activity.created_by !== req.user!.id) return res.status(403).json({ success: false, message: "You do not own this campaign." });
    const { data, error } = await supabase.rpc("release_activity_reserve", { p_activity_id: req.params.id, p_admin_id: req.user!.id, p_note: "Closed by campaign owner" });
    if (error || !data) return res.status(400).json({ success: false, message: "Campaign could not be closed." });
    return res.json({ success: true, campaign: data });
  }

  const updates: Record<string, unknown> = {};
  if (req.body?.title !== undefined) {
    const title = String(req.body.title).trim();
    if (title.length < TITLE_MIN || title.length > TITLE_MAX) return res.status(400).json({ success: false, code: "INVALID_CAMPAIGN_TITLE", message: `Campaign title must be between ${TITLE_MIN} and ${TITLE_MAX} characters.` });
    updates.title = title;
  }
  if (req.body?.status !== undefined && req.body.status === "paused") updates.status = "paused";
  if (!Object.keys(updates).length) return res.status(400).json({ success: false, message: "No supported campaign changes were provided." });

  const { data, error } = await supabase.from("activities").update(updates).eq("id", req.params.id).eq("created_by", req.user!.id).select("*").single();
  if (error || !data) return res.status(404).json({ success: false, message: "Campaign not found or you do not own it." });
  return res.json({ success: true, campaign: data });
});

export default router;
