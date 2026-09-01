import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { supabase } from "../config/supabase.js";
import { requireIdentity, requireAdmin } from "../middleware/authMiddleware.js";

const router = Router();

const text = (v: unknown, max = 2000) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

const hash = (v: string) =>
  crypto.createHash("sha256").update(v).digest("hex");

const blocked =
  /(sexual\s*minor|child\s*nude|non[- ]?consensual|terrorist|scam\s*everyone)/i;

const categories = [
  "fake_shop",
  "counterfeit",
  "fraud",
  "item_not_received",
  "item_not_as_described",
  "abuse",
  "spam",
  "copyright",
  "sexual_content",
  "privacy",
  "payment",
  "other",
] as const;

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const VIDEO_TYPES = new Set([
  "video/mp4",
  "video/webm",
]);

const MAX_MEDIA_BYTES = 6 * 1024 * 1024;

/* =========================================================
   HELPERS
========================================================= */

async function audit(
  req: Request,
  type: string,
  target: string | null,
  metadata: Record<string, unknown> = {},
) {
  try {
    await supabase.from("audit_events").insert({
      actor_id: req.user?.id ?? null,
      target_user_id: target,
      event_type: type,
      metadata,
      ip_hash: hash(req.ip || ""),
      user_agent_hash: hash(
        String(req.headers["user-agent"] || ""),
      ),
    });
  } catch (e) {
    console.error("audit", e);
  }
}

async function follows(
  follower: string,
  following: string,
) {
  const { data, error } = await supabase
    .from("follows")
    .select("status")
    .eq("follower_id", follower)
    .eq("following_id", following)
    .maybeSingle();

  if (error) {
    console.error("follows", error);
    return null;
  }

  return data?.status || null;
}

/* =========================================================
   FEED
========================================================= */

router.get(
  "/feed",
  requireIdentity,
  async (req, res) => {
    try {
      const uid = req.user!.id;

      const {
        data: followingRows,
        error: followingError,
      } = await supabase
        .from("follows")
        .select("following_id")
        .eq("follower_id", uid)
        .eq("status", "accepted");

      if (followingError) {
        console.error("feed follows", followingError);
        throw followingError;
      }

      const ids = (followingRows ?? []).map(
        (x) => x.following_id,
      );

      let query = supabase
        .from("social_posts")
        /*
         * IMPORTANT:
         * social_posts has more than one relationship with users:
         *
         * - social_posts_user_id_fkey
         * - social_post_likes
         *
         * Therefore the relationship MUST be explicitly selected.
         */
        .select(
          `
          id,
          user_id,
          body,
          media_url,
          media_type,
          visibility,
          quality_score,
          created_at,
          moderation_status,
          originality_status,
          users!social_posts_user_id_fkey(
            id,
            username,
            account_visibility,
            shop_verified,
            shop_verification_level
          )
        `,
        )
        .eq("moderation_status", "approved")
        .order("created_at", {
          ascending: false,
        })
        .limit(
          Math.min(
            Math.max(
              Number(req.query.limit) || 30,
              1,
            ),
            100,
          ),
        );

      if (ids.length) {
        /*
         * Show:
         * - public posts
         * - follower-only posts from accounts the user follows
         */
        query = query.or(
          `visibility.eq.public,and(visibility.eq.followers,user_id.in.(${ids.join(",")}))`,
        );
      } else {
        query = query.eq(
          "visibility",
          "public",
        );
      }

      const {
        data,
        error,
      } = await query;

      if (error) {
        console.error("feed query", error);
        throw error;
      }

      return res.json({
        success: true,
        posts: data ?? [],
      });
    } catch (e) {
      console.error("feed", e);

      return res.status(500).json({
        success: false,
        message: "Unable to load feed",
      });
    }
  },
);

/* =========================================================
   PUBLIC USER PROFILE
========================================================= */

router.get(
  "/users/:id",
  async (req, res) => {
    try {
      const {
        data: user,
        error,
      } = await supabase
        .from("users")
        .select(
          `
          id,
          username,
          role,
          status,
          account_visibility,
          discoverable,
          shop_verified,
          shop_verification_level,
          created_at
        `,
        )
        .eq("id", req.params.id)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (
        !user ||
        user.status === "banned" ||
        user.discoverable === false
      ) {
        return res.status(404).json({
          success: false,
          message: "Profile not found",
        });
      }

      const counts = await supabase.rpc(
        "social_follow_counts",
        {
          p_user: user.id,
        },
      );

      return res.json({
        success: true,
        user: {
          ...user,
          followers:
            counts.data?.followers ?? 0,
          following:
            counts.data?.following ?? 0,
        },
      });
    } catch (e) {
      console.error("public profile", e);

      return res.status(500).json({
        success: false,
        message: "Unable to load profile",
      });
    }
  },
);

/* =========================================================
   FOLLOW
========================================================= */

router.post(
  "/follow/:id",
  requireIdentity,
  async (req, res) => {
    try {
      const target = text(
        req.params.id,
        80,
      );

      if (target === req.user!.id) {
        return res.status(400).json({
          success: false,
          message: "You cannot follow yourself",
        });
      }

      const {
        data: user,
        error: userError,
      } = await supabase
        .from("users")
        .select(
          "id,status,account_visibility",
        )
        .eq("id", target)
        .maybeSingle();

      if (userError) {
        throw userError;
      }

      if (
        !user ||
        user.status === "banned"
      ) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const status =
        user.account_visibility === "private"
          ? "pending"
          : "accepted";

      const {
        error,
      } = await supabase
        .from("follows")
        .upsert(
          {
            follower_id: req.user!.id,
            following_id: target,
            status,
          },
          {
            onConflict:
              "follower_id,following_id",
          },
        );

      if (error) {
        throw error;
      }

      await audit(
        req,
        "follow",
        target,
        { status },
      );

      return res.json({
        success: true,
        status,
      });
    } catch (e) {
      console.error("follow", e);

      return res.status(500).json({
        success: false,
        message: "Unable to follow user",
      });
    }
  },
);

router.delete(
  "/follow/:id",
  requireIdentity,
  async (req, res) => {
    const {
      error,
    } = await supabase
      .from("follows")
      .delete()
      .eq(
        "follower_id",
        req.user!.id,
      )
      .eq(
        "following_id",
        req.params.id,
      );

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Unable to unfollow",
      });
    }

    return res.json({
      success: true,
    });
  },
);

/* =========================================================
   MEDIA UPLOAD
========================================================= */

router.post(
  "/upload",
  requireIdentity,
  async (
    req: Request,
    res: Response,
  ) => {
    try {
      const dataUrl = text(
        req.body?.dataUrl,
        10 * 1024 * 1024,
      );

      const mediaType = text(
        req.body?.mediaType,
        40,
      ).toLowerCase();

      const allowed =
        IMAGE_TYPES.has(mediaType) ||
        VIDEO_TYPES.has(mediaType);

      if (!allowed) {
        return res.status(400).json({
          success: false,
          message:
            "Choose a supported image or video.",
        });
      }

      const escaped =
        mediaType.replace("/", "\\/");

      const match = dataUrl.match(
        new RegExp(
          `^data:(${escaped});base64,([A-Za-z0-9+/=]+)$`,
          "i",
        ),
      );

      if (!match) {
        return res.status(400).json({
          success: false,
          message:
            "The selected media could not be read.",
        });
      }

      const buffer = Buffer.from(
        match[2],
        "base64",
      );

      if (
        !buffer.length ||
        buffer.length > MAX_MEDIA_BYTES
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Media must be smaller than 6 MB.",
        });
      }

      const ext = mediaType
        .split("/")[1]
        .replace("jpeg", "jpg");

      const path =
        `${req.user!.id}/posts/${crypto.randomUUID()}.${ext}`;

      const {
        error,
      } = await supabase.storage
        .from("user-media")
        .upload(
          path,
          buffer,
          {
            contentType: mediaType,
            upsert: false,
            cacheControl: "3600",
          },
        );

      if (error) {
        console.error(
          "social media upload",
          error,
        );

        return res.status(503).json({
          success: false,
          message:
            "Unable to upload media right now.",
        });
      }

      const {
        data,
      } = supabase.storage
        .from("user-media")
        .getPublicUrl(path);

      await audit(
        req,
        "social_media_uploaded",
        req.user!.id,
        {
          path,
          mediaType,
        },
      );

      return res.status(201).json({
        success: true,
        url: data.publicUrl,
        mediaType,
      });
    } catch (e) {
      console.error(
        "social upload",
        e,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to upload media.",
      });
    }
  },
);

/* =========================================================
   CREATE POST
========================================================= */

router.post(
  "/posts",
  requireIdentity,
  async (req, res) => {
    try {
      if (
        !req.user!.content_participant
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Join the creator program to publish content.",
          code: "PROGRAM_REQUIRED",
        });
      }

      const body = text(
        req.body?.body,
        5000,
      );

      const mediaUrl =
        text(
          req.body?.mediaUrl,
          2000,
        ) || null;

      const mediaType =
        text(
          req.body?.mediaType,
          20,
        ) || null;

      const visibility =
        [
          "public",
          "followers",
          "private",
        ].includes(
          req.body?.visibility,
        )
          ? req.body.visibility
          : "public";

      if (!body && !mediaUrl) {
        return res.status(400).json({
          success: false,
          message:
            "Post content is required",
        });
      }

      const status = blocked.test(body)
        ? "review"
        : "pending";

      const {
        data,
        error,
      } = await supabase
        .from("social_posts")
        .insert({
          user_id: req.user!.id,
          body,
          media_url: mediaUrl,
          media_type: mediaType,
          visibility,
          moderation_status: status,
          originality_status:
            "pending",
          quality_score: 0,
        })
        .select(
          `
          id,
          user_id,
          body,
          media_url,
          media_type,
          visibility,
          moderation_status,
          originality_status,
          created_at
        `,
        )
        .single();

      if (error) {
        throw error;
      }

      if (status === "review") {
        await supabase
          .from("moderation_cases")
          .insert({
            post_id: data.id,
            user_id: req.user!.id,
            case_type:
              "sexual_content",
            confidence: 0.75,
            provider:
              "policy-engine",
            reason:
              "Automated policy signal; human review required",
            action: "review",
          });
      }

      await audit(
        req,
        "post_created",
        req.user!.id,
        {
          postId: data.id,
        },
      );

      return res.status(201).json({
        success: true,
        post: data,
        message:
          status === "review"
            ? "Post submitted for safety review"
            : "Post submitted for review",
      });
    } catch (e) {
      console.error("post", e);

      return res.status(500).json({
        success: false,
        message:
          "Unable to publish post",
      });
    }
  },
);

/* =========================================================
   LIKES
========================================================= */

router.post(
  "/posts/:id/like",
  requireIdentity,
  async (req, res) => {
    const {
      error,
    } = await supabase
      .from("social_post_likes")
      .upsert(
        {
          post_id: req.params.id,
          user_id: req.user!.id,
        },
        {
          onConflict:
            "post_id,user_id",
        },
      );

    if (error) {
      console.error(
        "like",
        error,
      );

      return res.status(400).json({
        success: false,
        message:
          "Unable to like post",
      });
    }

    return res.json({
      success: true,
      liked: true,
    });
  },
);

router.delete(
  "/posts/:id/like",
  requireIdentity,
  async (req, res) => {
    const {
      error,
    } = await supabase
      .from("social_post_likes")
      .delete()
      .eq(
        "post_id",
        req.params.id,
      )
      .eq(
        "user_id",
        req.user!.id,
      );

    if (error) {
      return res.status(400).json({
        success: false,
        message:
          "Unable to remove like",
      });
    }

    return res.json({
      success: true,
      liked: false,
    });
  },
);

/* =========================================================
   COMMENTS
========================================================= */

router.post(
  "/posts/:id/comments",
  requireIdentity,
  async (req, res) => {
    const body = text(
      req.body?.body,
      1000,
    );

    if (!body) {
      return res.status(400).json({
        success: false,
        message:
          "Comment is required",
      });
    }

    if (blocked.test(body)) {
      return res.status(400).json({
        success: false,
        message:
          "Comment blocked by safety policy",
      });
    }

    const {
      data,
      error,
    } = await supabase
      .from("social_comments")
      .insert({
        post_id: req.params.id,
        user_id: req.user!.id,
        body,
      })
      .select(
        `
        id,
        post_id,
        user_id,
        body,
        created_at
        `,
      )
      .single();

    if (error) {
      console.error(
        "comment",
        error,
      );

      return res.status(400).json({
        success: false,
        message:
          "Unable to comment",
      });
    }

    return res.status(201).json({
      success: true,
      comment: data,
    });
  },
);

/* =========================================================
   SHOP REVIEWS
========================================================= */

router.get(
  "/shops/:shopId/reviews",
  async (req, res) => {
    const {
      data,
      error,
    } = await supabase
      .from("shop_reviews")
      .select(
        `
        id,
        rating,
        title,
        body,
        verified_purchase,
        created_at,
        users!shop_reviews_buyer_id_fkey(
          id,
          username
        )
        `,
      )
      .eq(
        "shop_id",
        req.params.shopId,
      )
      .eq(
        "status",
        "published",
      )
      .order(
        "created_at",
        {
          ascending: false,
        },
      )
      .limit(100);

    if (error) {
      console.error(
        "shop reviews",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load reviews",
      });
    }

    return res.json({
      success: true,
      reviews: data ?? [],
    });
  },
);

router.post(
  "/shops/:shopId/reviews",
  requireIdentity,
  async (req, res) => {
    try {
      const rating = Math.floor(
        Number(req.body?.rating),
      );

      if (
        rating < 1 ||
        rating > 5
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Rating must be 1 to 5",
        });
      }

      const {
        data: order,
      } = await supabase
        .from("shop_orders")
        .select("id")
        .eq(
          "shop_id",
          req.params.shopId,
        )
        .eq(
          "buyer_id",
          req.user!.id,
        )
        .eq(
          "status",
          "delivered",
        )
        .maybeSingle();

      const {
        data,
        error,
      } = await supabase
        .from("shop_reviews")
        .insert({
          shop_id:
            req.params.shopId,
          order_id:
            order?.id ?? null,
          buyer_id:
            req.user!.id,
          rating,
          title:
            text(
              req.body?.title,
              200,
            ) || null,
          body: text(
            req.body?.body,
            2000,
          ),
          verified_purchase:
            Boolean(order),
        })
        .select(
          `
          id,
          rating,
          title,
          body,
          verified_purchase,
          created_at
          `,
        )
        .single();

      if (error) {
        return res.status(400).json({
          success: false,
          message:
            error.code === "23505"
              ? "You already reviewed this order"
              : "Unable to publish review",
        });
      }

      return res.status(201).json({
        success: true,
        review: data,
      });
    } catch (e) {
      console.error(
        "shop review",
        e,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to publish review",
      });
    }
  },
);

/* =========================================================
   COMPLAINTS
========================================================= */

router.post(
  "/complaints",
  requireIdentity,
  async (req, res) => {
    try {
      const category =
        categories.includes(
          req.body?.category,
        )
          ? req.body.category
          : "other";

      const subject = text(
        req.body?.subject,
        200,
      );

      const description = text(
        req.body?.description,
        5000,
      );

      if (
        !subject ||
        !description
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Subject and description are required",
        });
      }

      const {
        data,
        error,
      } = await supabase
        .from("support_complaints")
        .insert({
          reporter_id:
            req.user!.id,
          target_user_id:
            text(
              req.body?.targetUserId,
              80,
            ) || null,
          shop_id:
            text(
              req.body?.shopId,
              80,
            ) || null,
          order_id:
            text(
              req.body?.orderId,
              80,
            ) || null,
          post_id:
            text(
              req.body?.postId,
              80,
            ) || null,
          category,
          subject,
          description,
          attachments:
            Array.isArray(
              req.body?.attachments,
            )
              ? req.body.attachments.slice(
                  0,
                  5,
                )
              : [],
          priority:
            category === "fraud" ||
            category === "fake_shop"
              ? "high"
              : "normal",
        })
        .select(
          "id,status,priority,created_at",
        )
        .single();

      if (error) {
        throw error;
      }

      await audit(
        req,
        "complaint_created",
        req.user!.id,
        {
          complaintId: data.id,
          category,
        },
      );

      return res.status(201).json({
        success: true,
        ticket: data,
      });
    } catch (e) {
      console.error(
        "complaint",
        e,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to submit complaint",
      });
    }
  },
);

router.get(
  "/complaints",
  requireIdentity,
  async (req, res) => {
    const {
      data,
      error,
    } = await supabase
      .from("support_complaints")
      .select(
        "id,category,subject,status,priority,resolution,created_at,updated_at",
      )
      .eq(
        "reporter_id",
        req.user!.id,
      )
      .order(
        "created_at",
        {
          ascending: false,
        },
      );

    if (error) {
      return res.status(500).json({
        success: false,
        message:
          "Unable to load complaints",
      });
    }

    return res.json({
      success: true,
      tickets: data ?? [],
    });
  },
);

/* =========================================================
   DIRECT MESSAGES
========================================================= */

router.post(
  "/messages/:userId",
  requireIdentity,
  async (req, res) => {
    try {
      const recipient = text(
        req.params.userId,
        80,
      );

      const body = text(
        req.body?.body,
        3000,
      );

      if (!body) {
        return res.status(400).json({
          success: false,
          message:
            "Message is required",
        });
      }

      const {
        data: user,
        error: userError,
      } = await supabase
        .from("users")
        .select(
          "id,allow_direct_messages",
        )
        .eq(
          "id",
          recipient,
        )
        .maybeSingle();

      if (userError) {
        throw userError;
      }

      if (!user) {
        return res.status(404).json({
          success: false,
          message:
            "User not found",
        });
      }

      const relation =
        await follows(
          req.user!.id,
          recipient,
        );

      if (
        user.allow_direct_messages ===
          "nobody" ||
        (
          user.allow_direct_messages ===
            "followers" &&
          relation !== "accepted"
        )
      ) {
        return res.status(403).json({
          success: false,
          message:
            "This user does not accept messages from you",
        });
      }

      const {
        data,
        error,
      } = await supabase
        .from("direct_messages")
        .insert({
          sender_id:
            req.user!.id,
          recipient_id:
            recipient,
          body,
          moderation_status:
            blocked.test(body)
              ? "review"
              : "approved",
        })
        .select(
          `
          id,
          recipient_id,
          body,
          moderation_status,
          created_at
          `,
        )
        .single();

      if (error) {
        throw error;
      }

      return res.status(201).json({
        success: true,
        message: data,
      });
    } catch (e) {
      console.error(
        "message",
        e,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to send message",
      });
    }
  },
);

/* =========================================================
   SOCIAL SETTINGS
========================================================= */

router.get(
  "/settings",
  requireIdentity,
  async (req, res) => {
    const {
      data,
      error,
    } = await supabase
      .from("social_settings")
      .select("*")
      .eq(
        "user_id",
        req.user!.id,
      )
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        success: false,
        message:
          "Unable to load settings",
      });
    }

    return res.json({
      success: true,
      settings:
        data ?? {
          theme: "system",
        },
    });
  },
);

router.patch(
  "/settings",
  requireIdentity,
  async (req, res) => {
    try {
      const patch: Record<
        string,
        unknown
      > = {};

      for (
        const key of [
          "show_activity",
          "allow_tagging",
          "allow_comments",
          "show_followers",
          "discover_posts",
        ]
      ) {
        if (
          req.body?.[key] !==
          undefined
        ) {
          patch[key] =
            Boolean(
              req.body[key],
            );
        }
      }

      if (
        [
          "system",
          "light",
          "dark",
        ].includes(
          req.body?.theme,
        )
      ) {
        patch.theme =
          req.body.theme;
      }

      const userPatch: Record<
        string,
        unknown
      > = {};

      if (
        [
          "public",
          "private",
        ].includes(
          req.body?.accountVisibility,
        )
      ) {
        userPatch.account_visibility =
          req.body.accountVisibility;
      }

      if (
        [
          "everyone",
          "followers",
          "nobody",
        ].includes(
          req.body
            ?.allowDirectMessages,
        )
      ) {
        userPatch.allow_direct_messages =
          req.body.allowDirectMessages;
      }

      if (
        req.body?.discoverable !==
        undefined
      ) {
        userPatch.discoverable =
          Boolean(
            req.body.discoverable,
          );
      }

      const {
        error,
      } = await supabase
        .from("social_settings")
        .upsert(
          {
            user_id:
              req.user!.id,
            ...patch,
          },
          {
            onConflict:
              "user_id",
          },
        );

      if (error) {
        return res.status(500).json({
          success: false,
          message:
            "Unable to save settings",
        });
      }

      if (
        Object.keys(
          userPatch,
        ).length
      ) {
        const {
          error: userError,
        } = await supabase
          .from("users")
          .update(userPatch)
          .eq(
            "id",
            req.user!.id,
          );

        if (userError) {
          return res.status(500).json({
            success: false,
            message:
              "Unable to save privacy settings",
          });
        }
      }

      return res.json({
        success: true,
      });
    } catch (e) {
      console.error(
        "settings",
        e,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to save settings",
      });
    }
  },
);

/* =========================================================
   ADMIN — SHOP VERIFICATIONS
========================================================= */

router.get(
  "/admin/shops/verifications",
  requireIdentity,
  requireAdmin,
  async (req, res) => {
    const {
      data,
      error,
    } = await supabase
      .from(
        "shop_verification_requests",
      )
      .select(
        `
        *,
        business_shops(
          name,
          store_slug,
          user_id
        )
        `,
      )
      .eq(
        "status",
        "pending",
      )
      .order(
        "created_at",
        {
          ascending: true,
        },
      );

    if (error) {
      return res.status(500).json({
        success: false,
        message:
          "Unable to load verification queue",
      });
    }

    return res.json({
      success: true,
      requests: data ?? [],
    });
  },
);

router.patch(
  "/admin/shops/verifications/:id",
  requireIdentity,
  requireAdmin,
  async (req, res) => {
    const status = [
      "approved",
      "rejected",
      "more_info",
    ].includes(
      req.body?.status,
    )
      ? req.body.status
      : null;

    if (!status) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid verification status",
      });
    }

    const {
      data: request,
      error,
    } = await supabase
      .from(
        "shop_verification_requests",
      )
      .update({
        status,
        reviewed_by:
          req.user!.id,
        reviewed_at:
          new Date().toISOString(),
      })
      .eq(
        "id",
        req.params.id,
      )
      .select(
        "shop_id,user_id",
      )
      .single();

    if (error) {
      return res.status(400).json({
        success: false,
        message:
          "Verification request not found",
      });
    }

    if (
      status === "approved"
    ) {
      await supabase
        .from("business_shops")
        .update({
          is_verified: true,
          verification_badge:
            "verified",
        })
        .eq(
          "id",
          request.shop_id,
        );
    }

    await supabase
      .from("users")
      .update({
        shop_verified:
          status === "approved",
        shop_verification_level:
          status === "approved"
            ? "verified"
            : "none",
      })
      .eq(
        "id",
        request.user_id,
      );

    await audit(
      req,
      "shop_verification",
      request.user_id,
      {
        shopId:
          request.shop_id,
        status,
      },
    );

    return res.json({
      success: true,
      status,
    });
  },
);

/* =========================================================
   ADMIN — COMPLAINTS
========================================================= */

router.get(
  "/admin/complaints",
  requireIdentity,
  requireAdmin,
  async (req, res) => {
    const {
      data,
      error,
    } = await supabase
      .from(
        "support_complaints",
      )
      .select("*")
      .order(
        "created_at",
        {
          ascending: false,
        },
      )
      .limit(200);

    if (error) {
      return res.status(500).json({
        success: false,
        message:
          "Unable to load complaints",
      });
    }

    return res.json({
      success: true,
      tickets: data ?? [],
    });
  },
);

router.patch(
  "/admin/complaints/:id",
  requireIdentity,
  requireAdmin,
  async (req, res) => {
    const allowed = [
      "open",
      "investigating",
      "resolved",
      "rejected",
      "escalated",
    ];

    if (
      !allowed.includes(
        req.body?.status,
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid status",
      });
    }

    const {
      data,
      error,
    } = await supabase
      .from(
        "support_complaints",
      )
      .update({
        status:
          req.body.status,
        resolution:
          text(
            req.body?.resolution,
            3000,
          ) || null,
      })
      .eq(
        "id",
        req.params.id,
      )
      .select(
        "id,status,resolution",
      )
      .single();

    if (error) {
      return res.status(400).json({
        success: false,
        message:
          "Complaint not found",
      });
    }

    return res.json({
      success: true,
      ticket: data,
    });
  },
);

/* =========================================================
   ADMIN — POST MODERATION
========================================================= */

router.patch(
  "/admin/posts/:id",
  requireIdentity,
  requireAdmin,
  async (req, res) => {
    const action =
      req.body?.action;

    if (
      ![
        "approved",
        "rejected",
        "removed",
      ].includes(action)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid moderation action",
      });
    }

    const {
      data: post,
      error,
    } = await supabase
      .from("social_posts")
      .update({
        moderation_status:
          action,
      })
      .eq(
        "id",
        req.params.id,
      )
      .select(
        "id,user_id",
      )
      .single();

    if (error) {
      return res.status(400).json({
        success: false,
        message:
          "Post not found",
      });
    }

    await supabase
      .from(
        "moderation_cases",
      )
      .insert({
        post_id: post.id,
        user_id: post.user_id,
        case_type:
          req.body?.caseType ||
          "other",
        confidence:
          Number(
            req.body?.confidence,
          ) || 1,
        provider: "admin",
        reason: text(
          req.body?.reason,
          1000,
        ),
        action:
          action === "approved"
            ? "allow"
            : action === "removed"
              ? "remove"
              : "review",
        reviewed_by:
          req.user!.id,
      });

    return res.json({
      success: true,
      post,
    });
  },
);

/* =========================================================
   ADMIN — AUDIT
========================================================= */

router.get(
  "/admin/audit",
  requireIdentity,
  requireAdmin,
  async (req, res) => {
    const {
      data,
      error,
    } = await supabase
      .from("audit_events")
      .select("*")
      .order(
        "created_at",
        {
          ascending: false,
        },
      )
      .limit(500);

    if (error) {
      return res.status(500).json({
        success: false,
        message:
          "Unable to load audit events",
      });
    }

    return res.json({
      success: true,
      events: data ?? [],
    });
  },
);

export default router;