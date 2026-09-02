import { Router } from "express";
import { supabase } from "../config/supabase.js";
import { requireIdentity } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/program", requireIdentity, async (req, res) => {
  const { data, error } = await supabase
    .from("creator_program_enrollments")
    .select("status,accepted_terms_at,originality_required,quality_required")
    .eq("user_id", req.user!.id)
    .maybeSingle();

  if (error) {
    console.error("creator program status", error);
    return res.status(500).json({ success: false, message: "Unable to load creator program status" });
  }

  return res.json({
    success: true,
    joined: Boolean(data && data.status === "active"),
    program: data ?? null,
    activationRequired: req.user!.status !== "active",
    earningEligible: Boolean(req.user!.status === "active" && data?.status === "active"),
  });
});

router.post("/program/join", requireIdentity, async (req, res) => {
  if (req.body?.acceptTerms !== true) {
    return res.status(400).json({
      success: false,
      message: "You must accept the creator program terms",
      code: "TERMS_REQUIRED",
    });
  }

  const { data, error } = await supabase.rpc("join_creator_program", {
    p_user_id: req.user!.id,
  });

  if (error) {
    console.error("creator program join", error);
    if (error.message === "ACTIVATION_REQUIRED") {
      return res.status(403).json({
        success: false,
        message: "Activate your VSBIL earning account before joining the creator earning program.",
        code: "ACTIVATION_REQUIRED",
      });
    }
    return res.status(500).json({ success: false, message: "Unable to join creator program" });
  }

  return res.json({
    success: true,
    program: data,
    message: "Creator participation enabled",
  });
});

router.post("/program/leave", requireIdentity, async (req, res) => {
  const { error } = await supabase.rpc("leave_creator_program", {
    p_user_id: req.user!.id,
  });
  if (error) {
    console.error("creator program leave", error);
    return res.status(500).json({ success: false, message: "Unable to leave creator program" });
  }
  return res.json({ success: true, message: "Creator participation disabled" });
});

export default router;
