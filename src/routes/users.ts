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
  const { data, error } = await supabase.from("users").select("id,email,username,role,status,referral_code,bio,avatar_url,cover_url,account_visibility,discoverable,created_at,updated_at,email_verified_at,google_verified_at,phone_verified_at,last_login_at,last_active_at,suspended_at,suspension_reason,content_participant").eq("id", req.user!.id).single();
  if (error) return res.status(500).json({ success: false, message: "Unable to load profile" });
  return res.json({ success: true, user: data });
});

router.patch("/profile", async (req: Request, res: Response) => {
  const username = String(req.body?.username ?? "").trim();
  if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) return res.status(400).json({ success: false, message: "Choose a username between 3 and 30 characters." });
  const patch: Record<string, unknown> = { username, updated_at: new Date().toISOString() };
  if (req.body?.bio !== undefined) patch.bio = cleanText(req.body.bio, 300);
  if (["public", "private"].includes(req.body?.accountVisibility)) patch.account_visibility = req.body.accountVisibility;
  if (req.body?.discoverable !== undefined) patch.discoverable = Boolean(req.body.discoverable);
  const { data, error } = await supabase.from("users").update(patch).eq("id", req.user!.id).select("id,email,username,role,status,referral_code,bio,avatar_url,cover_url,account_visibility,discoverable,created_at,updated_at,email_verified_at,google_verified_at,phone_verified_at,content_participant").single();
  if (error) {
    const duplicate = error.code === "23505" || error.message.toLowerCase().includes("unique");
    return res.status(400).json({ success: false, message: duplicate ? "That username is already in use." : "Unable to update profile." });
  }
  await supabase.from("security_events").insert({ user_id: req.user!.id, event_type: "profile_updated", severity: "info", metadata: { fields: Object.keys(patch).filter(k => k !== "updated_at") } });
  return res.json({ success: true, user: data });
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
    const { data, error } = await supabase.from("users").update({ [field]: publicData.publicUrl, updated_at: new Date().toISOString() }).eq("id", req.user!.id).select("id,username,bio,avatar_url,cover_url,account_visibility,discoverable,created_at").single();
    if (error) return res.status(500).json({ success: false, message: "Image uploaded but profile could not be updated." });
    await supabase.from("security_events").insert({ user_id: req.user!.id, event_type: "profile_media_updated", severity: "info", metadata: { field, objectPath } });
    return res.status(201).json({ success: true, user: data, url: publicData.publicUrl });
  } catch (error) {
    console.error("profile media", error);
    return res.status(500).json({ success: false, message: "Unable to update profile media." });
  }
});

/* Public profile data is intentionally read-only. Editing remains available only through /profile. */
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
    return res.json({
      success: true,
      owner: isOwner,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        bio: user.bio,
        avatar_url: user.avatar_url,
        cover_url: user.cover_url,
        account_visibility: user.account_visibility,
        discoverable: user.discoverable,
        created_at: user.created_at,
        followers: counts.data?.followers ?? 0,
        following: counts.data?.following ?? 0,
        posts: isPrivate ? [] : (posts.data ?? []).filter((post) => post.visibility === "public" || isOwner),
        private_profile: isPrivate,
      },
    });
  } catch (error) {
    console.error("public profile", error);
    return res.status(500).json({ success: false, message: "Unable to load profile." });
  }
});

router.get("/public/:identifier/posts", async (req, res) => {
  try {
    const identifier = cleanText(req.params.identifier, 100);
    const byId = await supabase.from("users").select("id,account_visibility,discoverable,status").eq("id", identifier).maybeSingle();
    let user = byId.data;
    if (!user) {
      const byUsername = await supabase.from("users").select("id,account_visibility,discoverable,status").ilike("username", identifier).maybeSingle();
      user = byUsername.data;
    }
    if (!user || user.status === "banned" || user.status === "suspended" || user.discoverable === false) return res.status(404).json({ success: false, message: "Profile not found" });
    const owner = user.id === req.user!.id;
    if (user.account_visibility === "private" && !owner) return res.json({ success: true, posts: [], private_profile: true });
    const { data, error } = await supabase.from("social_posts").select("id,user_id,body,media_url,media_type,visibility,created_at").eq("user_id", user.id).eq("moderation_status", "approved").order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return res.json({ success: true, posts: (data ?? []).filter((post) => owner || post.visibility === "public"), private_profile: false });
  } catch (error) {
    console.error("public profile posts", error);
    return res.status(500).json({ success: false, message: "Unable to load posts." });
  }
});

export default router;
