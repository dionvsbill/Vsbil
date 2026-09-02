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

  const status = data?.status ?? null;
  return res.json({
    success: true,
    joined: status === "active",
    program: data ?? null,
    activationRequired: status === "pending_activation" || req.user!.status !== "active",
    earningEligible: Boolean(req.user!.status === "active" && status === "active"),
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
    if (error.message === "ACCOUNT_RESTRICTED") {
      return res.status(403).json({
        success: false,
        message: "This account cannot join the creator program.",
        code: "ACCOUNT_RESTRICTED",
      });
    }
    return res.status(500).json({ success: false, message: "Unable to join creator program" });
  }

  const pendingActivation = data?.status === "pending_activation";
  return res.json({
    success: true,
    program: data,
    activationRequired: pendingActivation,
    message: pendingActivation
      ? "Creator program joined. Activate your VSBIL account to unlock creator campaigns."
      : "Creator participation enabled",
    redirect: pendingActivation ? "/activation.html?next=creator-program" : "/creator.html",
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
