import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = Router();
router.use(requireAuth);
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const cleanText = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const publicProfileSelect = "id,username,role,status,referral_code,bio,avatar_url,cover_url,account_visibility,discoverable,created_at,updated_at";

router.get("/referrals", async (req, res) => {
  const [{ data: user, error: userError }, { data: rows, error: referralError }] = await Promise.all([
    supabase.from("users").select("referral_code").eq("id", req.user!.id).single(),
    supabase.from("referrals").select("id,new_user_bonus_coins,referrer_bonus_coins,status,created_at,referred_user_id,qualified_at").eq("referrer_id", req.user!.id).order("created_at", { ascending: false }).limit(200),
  ]);
  if (userError || referralError) return res.status(500).json({ success: false, message: "Unable to load referrals" });
  return res.json({ success: true, referralCode: user?.referral_code ?? null, referrals: rows ?? [] });
});

router.get("/profile", async (req, res) => {
  const { data, error } = await supabase.from("users").select("id,email,username,role,status,referral_code,bio,avatar_url,cover_url,account_visibility,discoverable,allow_direct_messages,created_at,updated_at,email_verified_at,google_verified_at,phone_verified_at,last_login_at,last_active_at,suspended_at,suspension_reason,content_participant").eq("id", req.user!.id).single();
  if (error) return res.status(500).json({ success: false, message: "Unable to load profile" });
  return res.json({ success: true, user: data });
});

router.patch("/profile", async (req: Request, res: Response) => {
  const username = String(req.body?.username ?? "").trim();
  if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) return res.status(400).json({ success: false, message: "Choose a username between 3 and 30 characters." });
  const patch: Record<string, unknown> = { username, updated_at: new Date().toISOString() };
  if (req.body?.bio !== undefined) patch.bio = cleanText(req.body.bio, 300);
  if (["public", "private"].includes(req.body?.accountVisibility)) patch.account_visibility = req.body.accountVisibility;
  if (["everyone", "followers", "nobody"].includes(req.body?.allowDirectMessages)) patch.allow_direct_messages = req.body.allowDirectMessages;
  if (req.body?.discoverable !== undefined) patch.discoverable = Boolean(req.body.discoverable);
  const { data, error } = await supabase.from("users").update(patch).eq("id", req.user!.id).select("id,email,username,role,status,referral_code,bio,avatar_url,cover_url,account_visibility,discoverable,allow_direct_messages,created_at,updated_at,email_verified_at,google_verified_at,phone_verified_at,content_participant").single();
  if (error) {
    const duplicate = error.code === "23505" || error.message.toLowerCase().includes("unique");
    return res.status(400).json({ success: false, message: duplicate ? "That username is already in use." : "Unable to update profile." });
  }
  await supabase.from("security_events").insert({ user_id: req.user!.id, event_type: "profile_updated", severity: "info", metadata: { fields: Object.keys(patch).filter(k => k !== "updated_at") } });
  return res.json({ success: true, user: data });
});

/* =========================================================
   SETTINGS CENTER
   These endpoints back the Settings UI directly.  No settings
   control is merely decorative: profile/account values are stored
   in users and social preferences are stored in social_settings.
   ========================================================= */
router.get("/settings/center", async (req, res) => {
  try {
    const [profile, social, creator, referrals] = await Promise.all([
      supabase.from("users").select("id,email,username,role,status,referral_code,bio,avatar_url,cover_url,account_visibility,discoverable,allow_direct_messages,email_verified_at,google_verified_at,phone_verified_at,created_at,last_login_at,last_active_at,content_participant").eq("id", req.user!.id).single(),
      supabase.from("social_settings").select("*").eq("user_id", req.user!.id).maybeSingle(),
      supabase.from("creator_program_enrollments").select("status,accepted_terms_at,originality_required,quality_required,updated_at").eq("user_id", req.user!.id).maybeSingle(),
      supabase.from("users").select("referral_code").eq("id", req.user!.id).single(),
    ]);
    if (profile.error) throw profile.error;
    return res.json({ success: true, profile: profile.data, privacy: social.data ?? { theme: "system" }, creator: creator.data ?? { status: "not_joined" }, referralCode: referrals.data?.referral_code ?? null });
  } catch (e) {
    console.error("settings center", e);
    return res.status(500).json({ success: false, message: "Unable to load settings" });
  }
});

router.patch("/settings/account", async (req, res) => {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (req.body?.bio !== undefined) patch.bio = cleanText(req.body.bio, 300);
  if (req.body?.accountVisibility !== undefined) {
    if (!["public", "private"].includes(req.body.accountVisibility)) return res.status(400).json({ success: false, message: "Invalid profile visibility" });
    patch.account_visibility = req.body.accountVisibility;
  }
  if (req.body?.discoverable !== undefined) patch.discoverable = Boolean(req.body.discoverable);
  if (req.body?.allowDirectMessages !== undefined) {
    if (!["everyone", "followers", "nobody"].includes(req.body.allowDirectMessages)) return res.status(400).json({ success: false, message: "Invalid messaging preference" });
    patch.allow_direct_messages = req.body.allowDirectMessages;
  }
  if (req.body?.username !== undefined) {
    const username = String(req.body.username).trim();
    if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) return res.status(400).json({ success: false, message: "Choose a username between 3 and 30 characters." });
    patch.username = username;
  }
  const { data, error } = await supabase.from("users").update(patch).eq("id", req.user!.id).select("id,email,username,role,status,referral_code,bio,avatar_url,cover_url,account_visibility,discoverable,allow_direct_messages,email_verified_at,google_verified_at,phone_verified_at,created_at,last_login_at,last_active_at,content_participant").single();
  if (error) return res.status(400).json({ success: false, message: error.code === "23505" ? "That username is already in use." : "Unable to save account settings" });
  await supabase.from("security_events").insert({ user_id: req.user!.id, event_type: "account_settings_updated", severity: "info", metadata: { fields: Object.keys(patch).filter(k => k !== "updated_at") } });
  return res.json({ success: true, user: data });
});

router.patch("/settings/privacy", async (req, res) => {
  const allowed = ["show_activity", "allow_tagging", "allow_comments", "show_followers", "discover_posts", "theme", "language", "region", "autoplay", "video_quality", "data_saver", "sensitive_content", "email_notifications", "push_notifications", "sms_notifications"];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) if (req.body?.[key] !== undefined) {
    if (["theme", "language", "region", "autoplay", "video_quality", "sensitive_content"].includes(key)) patch[key] = cleanText(req.body[key], 40);
    else patch[key] = Boolean(req.body[key]);
  }
  if (patch.theme && !["system", "light", "dark"].includes(String(patch.theme))) return res.status(400).json({ success: false, message: "Invalid theme" });
  const { data, error } = await supabase.from("social_settings").upsert({ user_id: req.user!.id, ...patch, updated_at: new Date().toISOString() }, { onConflict: "user_id" }).select("*").single();
  if (error) return res.status(400).json({ success: false, message: "Unable to save privacy preferences" });
  await supabase.from("security_events").insert({ user_id: req.user!.id, event_type: "privacy_settings_updated", severity: "info", metadata: { fields: Object.keys(patch) } });
  return res.json({ success: true, settings: data });
});

router.get("/settings/security-activity", async (req, res) => {
  const { data, error } = await supabase.from("security_events").select("id,event_type,severity,metadata,created_at").eq("user_id", req.user!.id).order("created_at", { ascending: false }).limit(100);
  if (error) return res.status(500).json({ success: false, message: "Unable to load security activity" });
  return res.json({ success: true, events: data ?? [] });
});

router.post("/settings/export", async (req, res) => {
  try {
    const uid = req.user!.id;
    const [{ data: profile }, { data: social }, { data: referrals }, { data: posts }] = await Promise.all([
      supabase.from("users").select("id,email,username,role,status,referral_code,bio,avatar_url,cover_url,account_visibility,discoverable,allow_direct_messages,created_at,updated_at,email_verified_at,google_verified_at,phone_verified_at,content_participant").eq("id", uid).single(),
      supabase.from("social_settings").select("*").eq("user_id", uid).maybeSingle(),
      supabase.from("referrals").select("id,new_user_bonus_coins,referrer_bonus_coins,status,created_at,referred_user_id,qualified_at").eq("referrer_id", uid).limit(500),
      supabase.from("social_posts").select("id,body,media_url,media_type,visibility,moderation_status,originality_status,created_at").eq("user_id", uid).limit(500),
    ]);
    await supabase.from("security_events").insert({ user_id: uid, event_type: "account_data_exported", severity: "info", metadata: { postCount: posts?.length ?? 0, referralCount: referrals?.length ?? 0 } });
    return res.json({ success: true, exportedAt: new Date().toISOString(), account: profile, privacy: social, referrals: referrals ?? [], posts: posts ?? [] });
  } catch (e) {
    console.error("settings export", e);
    return res.status(500).json({ success: false, message: "Unable to prepare account export" });
  }
});

router.post("/settings/deactivate", async (req, res) => {
  if (req.body?.confirm !== true) return res.status(400).json({ success: false, message: "Confirmation is required" });
  const { data, error } = await supabase.from("users").update({ status: "inactive", updated_at: new Date().toISOString() }).eq("id", req.user!.id).select("id,status").single();
  if (error) return res.status(400).json({ success: false, message: "Unable to deactivate account" });
  await supabase.from("security_events").insert({ user_id: req.user!.id, event_type: "account_deactivated", severity: "warning", metadata: {} });
  return res.json({ success: true, account: data, message: "Account deactivated" });
});

router.post("/settings/security-event", async (req, res) => {
  const eventType = cleanText(req.body?.eventType, 80);
  if (!/^[a-z0-9_:-]{3,80}$/i.test(eventType)) return res.status(400).json({ success: false, message: "Invalid security event" });
  await supabase.from("security_events").insert({ user_id: req.user!.id, event_type: eventType, severity: "info", metadata: { source: "settings" } });
  return res.json({ success: true });
});

router.post("/profile/media", async (req: Request, res: Response) => {
  try {
    const dataUrl = cleanText(req.body?.dataUrl, 10 * 1024 * 1024);
    const mediaType = cleanText(req.body?.mediaType, 30).toLowerCase();
    const field = req.body?.field === "cover" ? "cover_url" : "avatar_url";
    if (!dataUrl.startsWith("data:") || !IMAGE_TYPES.has(mediaType)) return res.status(400).json({ success: false, message: "Choose a supported image file." });
    const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) return res.status(400).json({ success: false, message: "The selected image could not be read." });
    const contentType = match[1].toLowerCase();
    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return res.status(400).json({ success: false, message: "Image must be smaller than 6 MB." });
    const ext = contentType.split("/")[1].replace("jpeg", "jpg");
    const objectPath = `${req.user!.id}/${field.replace("_url", "")}-${crypto.randomUUID()}.${ext}`;
    const upload = await supabase.storage.from("user-media").upload(objectPath, buffer, { contentType, upsert: false, cacheControl: "3600" });
    if (upload.error) { console.error("profile media upload", upload.error); return res.status(503).json({ success: false, message: "Unable to upload the image right now." }); }
    const { data: publicData } = supabase.storage.from("user-media").getPublicUrl(objectPath);
    const { data, error } = await supabase.from("users").update({ [field]: publicData.publicUrl, updated_at: new Date().toISOString() }).eq("id", req.user!.id).select("id,username,bio,avatar_url,cover_url,account_visibility,discoverable,allow_direct_messages,created_at").single();
    if (error) return res.status(500).json({ success: false, message: "Image uploaded but profile could not be updated." });
    await supabase.from("security_events").insert({ user_id: req.user!.id, event_type: "profile_media_updated", severity: "info", metadata: { field, objectPath } });
    return res.status(201).json({ success: true, user: data, url: publicData.publicUrl });
  } catch (error) {
    console.error("profile media", error);
    return res.status(500).json({ success: false, message: "Unable to update profile media." });
  }
});

router.get("/public/:identifier", async (req, res) => {
  try {
    const identifier = cleanText(req.params.identifier, 100);
    const byId = await supabase.from("users").select(publicProfileSelect).eq("id", identifier).maybeSingle();
    let user = byId.data;
    if (!user) {
      const byUsername = await supabase.from("users").select(publicProfileSelect).ilike("username", identifier).maybeSingle();
      user = byUsername.data;
    }
    if (!user || user.status === "banned" || user.status === "suspended" || user.discoverable === false) return res.status(404).json({ success: false, message: "Profile not found" });
    const [counts, posts] = await Promise.all([
      supabase.rpc("social_follow_counts", { p_user: user.id }),
      supabase.from("social_posts").select("id,user_id,body,media_url,media_type,visibility,created_at").eq("user_id", user.id).eq("moderation_status", "approved").order("created_at", { ascending: false }).limit(50),
    ]);
    const isOwner = user.id === req.user!.id;
    const isPrivate = user.account_visibility === "private" && !isOwner;
    return res.json({ success: true, owner: isOwner, user: { id: user.id, username: user.username, role: user.role, bio: user.bio, avatar_url: user.avatar_url, cover_url: user.cover_url, account_visibility: user.account_visibility, discoverable: user.discoverable, created_at: user.created_at, followers: counts.data?.followers ?? 0, following: counts.data?.following ?? 0, posts: isPrivate ? [] : (posts.data ?? []).filter((post) => post.visibility === "public" || isOwner), private_profile: isPrivate } });
  } catch (error) { console.error("public profile", error); return res.status(500).json({ success: false, message: "Unable to load profile." }); }
});

router.get("/public/:identifier/posts", async (req, res) => {
  try {
    const identifier = cleanText(req.params.identifier, 100);
    const byId = await supabase.from("users").select("id,account_visibility,discoverable,status").eq("id", identifier).maybeSingle();
    let user = byId.data;
    if (!user) { const byUsername = await supabase.from("users").select("id,account_visibility,discoverable,status").ilike("username", identifier).maybeSingle(); user = byUsername.data; }
    if (!user || user.status === "banned" || user.status === "suspended" || user.discoverable === false) return res.status(404).json({ success: false, message: "Profile not found" });
    const owner = user.id === req.user!.id;
    if (user.account_visibility === "private" && !owner) return res.json({ success: true, posts: [], private_profile: true });
    const { data, error } = await supabase.from("social_posts").select("id,user_id,body,media_url,media_type,visibility,created_at").eq("user_id", user.id).eq("moderation_status", "approved").order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return res.json({ success: true, posts: (data ?? []).filter((post) => owner || post.visibility === "public"), private_profile: false });
  } catch (error) { console.error("public profile posts", error); return res.status(500).json({ success: false, message: "Unable to load posts." }); }
});

export default router;
