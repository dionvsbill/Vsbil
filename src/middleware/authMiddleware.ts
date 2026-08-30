import type { Request, Response, NextFunction } from "express";
import { supabase } from "../config/supabase.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string;
  role: string;
  status: string;
  content_participant?: boolean;
  account_visibility?: "public" | "private" | string;
  discoverable?: boolean;
  allow_direct_messages?: "everyone" | "followers" | "nobody" | string;
  shop_verified?: boolean;
  shop_verification_level?: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      rawBody?: Buffer;
    }
  }
}

function bearer(req: Request): string | null {
  const value = req.headers.authorization;
  if (typeof value !== "string" || !value.toLowerCase().startsWith("bearer ")) return null;
  const token = value.slice(7).trim();
  return token || null;
}

export async function identityMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const token = bearer(req);
    if (!token) {
      return res.status(401).json({ success: false, message: "Authentication required", code: "AUTH_REQUIRED" });
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ success: false, message: "Invalid or expired authentication token", code: "INVALID_TOKEN" });
    }

    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("id,email,username,role,status,content_participant,account_visibility,discoverable,allow_direct_messages,shop_verified,shop_verification_level")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Profile lookup failed", profileError);
      return res.status(500).json({ success: false, message: "Unable to load your account", code: "PROFILE_LOOKUP_FAILED" });
    }

    if (!profile || profile.email.toLowerCase() !== String(data.user.email || "").toLowerCase()) {
      return res.status(403).json({ success: false, message: "Account profile is unavailable", code: "PROFILE_MISMATCH" });
    }

    req.user = profile as AuthenticatedUser;
    return next();
  } catch (error) {
    console.error("Identity middleware", error);
    return res.status(500).json({ success: false, message: "Authentication service error", code: "AUTH_SERVICE_ERROR" });
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  return identityMiddleware(req, res, () => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required", code: "AUTH_REQUIRED" });
    }

    if (req.user.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Your account is not active",
        code: "ACCOUNT_NOT_ACTIVE",
        user: { id: req.user.id, username: req.user.username, status: req.user.status },
      });
    }

    return next();
  });
}

export const requireAuth = authMiddleware;
export const requireIdentity = identityMiddleware;

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Authentication required", code: "AUTH_REQUIRED" });
  }
  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Administrator access required", code: "ADMIN_REQUIRED" });
  }
  return next();
}
