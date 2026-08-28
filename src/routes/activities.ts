import { Router, type Request, type Response } from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = Router();
router.use(requireAuth);

function cleanUrl(value: unknown): string { return String(value ?? "").trim(); }
function isValidHttpUrl(value: string): boolean { return /^https?:\/\//i.test(value); }

router.get("/", async (_req, res) => {
  const { data, error } = await supabase.from("activities").select("id,title,platform,url,action,reward_amount,status,created_by,created_at").eq("status", "active").order("created_at", { ascending: false }).limit(100);
  if (error) return res.status(500).json({ success: false, message: "Unable to load campaigns" });
  return res.json({ success: true, activities: data ?? [] });
});

router.post("/", async (req: Request, res: Response) => {
  const title = String(req.body?.title ?? "").trim();
  const platform = String(req.body?.platform ?? "youtube").trim().toLowerCase();
  const url = cleanUrl(req.body?.url);
  const action = String(req.body?.action ?? "watch").trim().toLowerCase();
  const rewardGhs = Number(req.body?.rewardGhs);
  if (title.length < 3 || title.length > 120) return res.status(400).json({ success: false, message: "Campaign title must be between 3 and 120 characters." });
  if (platform !== "youtube") return res.status(400).json({ success: false, message: "Only YouTube campaigns are currently supported." });
  if (!isValidHttpUrl(url) || (!url.includes("youtube.com") && !url.includes("youtu.be"))) return res.status(400).json({ success: false, message: "Enter a valid YouTube URL." });
  if (!["watch", "like", "subscribe"].includes(action)) return res.status(400).json({ success: false, message: "Invalid campaign action." });
  if (!Number.isFinite(rewardGhs) || rewardGhs <= 0 || rewardGhs > 100) return res.status(400).json({ success: false, message: "Reward must be greater than GH₵0 and no more than GH₵100." });
  const { data, error } = await supabase.from("activities").insert({ title, platform, url, action, reward_amount: Math.round(rewardGhs * 100), status: "active", created_by: req.user!.id }).select("id,title,platform,url,action,reward_amount,status,created_by,created_at").single();
  if (error) return res.status(400).json({ success: false, message: "Unable to create campaign. Check that the database schema is up to date." });
  return res.status(201).json({ success: true, campaign: data });
});

router.post("/:id/submit", async (req: Request, res: Response) => {
  const proofUrl = String(req.body?.proofUrl || "").trim();
  if (proofUrl && !isValidHttpUrl(proofUrl)) return res.status(400).json({ success: false, message: "Proof URL must be a valid URL." });
  const { data, error } = await supabase.from("activity_submissions").insert({ user_id: req.user!.id, activity_id: req.params.id, proof_url: proofUrl || null, status: "pending" }).select("id,status").single();
  if (error) return res.status(400).json({ success: false, message: error.message.includes("duplicate") ? "You have already submitted this campaign." : "Unable to submit campaign." });
  return res.status(201).json({ success: true, submission: data });
});

router.patch("/:id", async (req: Request, res: Response) => {
  const updates: Record<string, unknown> = {};
  if (req.body?.title !== undefined) updates.title = String(req.body.title).trim();
  if (req.body?.status !== undefined && ["active", "paused", "archived"].includes(String(req.body.status))) updates.status = String(req.body.status);
  if (!Object.keys(updates).length) return res.status(400).json({ success: false, message: "No valid campaign changes were supplied." });
  const { data, error } = await supabase.from("activities").update(updates).eq("id", req.params.id).eq("created_by", req.user!.id).select("id,title,platform,url,action,reward_amount,status,created_by,created_at").single();
  if (error || !data) return res.status(404).json({ success: false, message: "Campaign not found or you do not own it." });
  return res.json({ success: true, campaign: data });
});
export default router;
