import { Router, type Request, type Response } from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middleware/authMiddleware.js";
const router = Router();
router.use(requireAuth);
router.get("/", async (_req, res) => {
  const { data, error } = await supabase.from("activities").select("id,title,platform,url,action,reward_amount,created_at").eq("status", "active").order("created_at", { ascending: false }).limit(100);
  if (error) return res.status(500).json({ success: false, message: "Unable to load activities" });
  return res.json({ success: true, activities: data ?? [] });
});
router.post("/:id/submit", async (req: Request, res: Response) => {
  const proofUrl = String(req.body?.proofUrl || "").trim();
  if (proofUrl && !/^https?:\/\//i.test(proofUrl)) return res.status(400).json({ success: false, message: "Proof URL must be a valid URL." });
  const { data, error } = await supabase.from("activity_submissions").insert({ user_id: req.user!.id, activity_id: req.params.id, proof_url: proofUrl || null, status: "pending" }).select("id,status").single();
  if (error) return res.status(400).json({ success: false, message: error.message.includes("duplicate") ? "You have already submitted this activity." : "Unable to submit activity." });
  return res.status(201).json({ success: true, submission: data });
});
export default router;
