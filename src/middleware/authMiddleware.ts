import type {
  Request,
  Response,
  NextFunction,
} from "express";

import { supabase } from "../config/supabase.js";


/* =========================================================
   AUTHENTICATED USER
   ========================================================= */

export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string;
  role: string;
  status: string;
}


/* =========================================================
   EXTEND EXPRESS REQUEST
   ========================================================= */

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}


/* =========================================================
   GET BEARER TOKEN
   ========================================================= */

function getBearerToken(
  req: Request
): string | null {

  const authorization =
    req.headers.authorization;

  if (
    typeof authorization !== "string"
  ) {
    return null;
  }

  if (
    !authorization
      .toLowerCase()
      .startsWith("bearer ")
  ) {
    return null;
  }

  const token =
    authorization
      .slice(7)
      .trim();

  if (!token) {
    return null;
  }

  return token;
}


/* =========================================================
   AUTH MIDDLEWARE
   ========================================================= */

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {

  try {

    /* =====================================================
       GET ACCESS TOKEN
       ===================================================== */

    const token =
      getBearerToken(req);


    if (!token) {

      res.status(401).json({
        success: false,
        message: "Authentication required",
        code: "AUTH_REQUIRED",
      });

      return;
    }


    /* =====================================================
       VERIFY TOKEN WITH SUPABASE
       ===================================================== */

    const {
      data: authData,
      error: authError,
    } =
      await supabase.auth.getUser(token);


    if (
      authError ||
      !authData?.user
    ) {

      console.error(
        "Authentication failed:",
        authError?.message ||
          "Invalid authentication token"
      );

      res.status(401).json({
        success: false,
        message:
          "Invalid or expired authentication token",
        code: "INVALID_TOKEN",
      });

      return;
    }


    /* =====================================================
       SUPABASE AUTH USER
       ===================================================== */

    const authUser =
      authData.user;


    const authUserId =
      authUser.id;


    /* =====================================================
       AUTH EMAIL
       ===================================================== */

    const authenticatedEmail =
      typeof authUser.email === "string"
        ? authUser.email
        : "";


    if (!authenticatedEmail) {

      res.status(401).json({
        success: false,
        message: "Authenticated email is missing",
        code: "EMAIL_MISSING",
      });

      return;
    }


    /* =====================================================
       LOAD VSBIL PROFILE
       ===================================================== */

    const {
      data: profile,
      error: profileError,
    } =
      await supabase
        .from("users")
        .select(
          `
            id,
            email,
            username,
            role,
            status
          `
        )
        .eq(
          "id",
          authUserId
        )
        .maybeSingle();


    /* =====================================================
       PROFILE DATABASE ERROR
       ===================================================== */

    if (profileError) {

      console.error(
        "Authenticated user lookup failed:",
        profileError
      );

      res.status(500).json({
        success: false,
        message:
          "Unable to load your account",
        code:
          "PROFILE_LOOKUP_FAILED",
      });

      return;
    }


    /* =====================================================
       PROFILE DOES NOT EXIST
       ===================================================== */

    if (!profile) {

      res.status(403).json({
        success: false,
        message:
          "Vsbil account not found",
        code:
          "PROFILE_NOT_FOUND",
      });

      return;
    }


    /* =====================================================
       VERIFY USER ID
       ===================================================== */

    if (
      profile.id !== authUserId
    ) {

      console.error(
        "Authentication user ID mismatch",
        {
          authUserId,
          profileId: profile.id,
        }
      );

      res.status(401).json({
        success: false,
        message:
          "Authentication failed",
        code:
          "USER_MISMATCH",
      });

      return;
    }


    /* =====================================================
       VERIFY PROFILE EMAIL
       ===================================================== */

    const profileEmail =
      typeof profile.email === "string"
        ? profile.email
        : "";


    if (!profileEmail) {

      console.error(
        "Vsbil profile email is missing",
        {
          userId: authUserId,
        }
      );

      res.status(500).json({
        success: false,
        message:
          "Your account profile is incomplete",
        code:
          "PROFILE_EMAIL_MISSING",
      });

      return;
    }


    if (
      profileEmail
        .toLowerCase()
        .trim() !==
      authenticatedEmail
        .toLowerCase()
        .trim()
    ) {

      console.error(
        "Auth email/profile email mismatch",
        {
          userId: authUserId,
          authEmail:
            authenticatedEmail,
          profileEmail,
        }
      );

      res.status(401).json({
        success: false,
        message:
          "Account authentication mismatch",
        code:
          "EMAIL_MISMATCH",
      });

      return;
    }


    /* =====================================================
       VERIFY ACCOUNT STATUS
       ===================================================== */

    const accountStatus =
      String(
        profile.status || ""
      ).toLowerCase();


    if (
      accountStatus !== "active"
    ) {

      res.status(403).json({
        success: false,
        message:
          "Your account is not active",
        code:
          "ACCOUNT_NOT_ACTIVE",

        user: {
          id: profile.id,
          username:
            profile.username,
          status:
            profile.status,
        },
      });

      return;
    }


    /* =====================================================
       NORMALIZE USER DATA
       ===================================================== */

    const username =
      typeof profile.username === "string"
        ? profile.username
        : "";


    const role =
      typeof profile.role === "string"
        ? profile.role
        : "user";


    /* =====================================================
       ATTACH AUTHENTICATED USER
       ===================================================== */

    req.user = {
      id: profile.id,
      email: authenticatedEmail,
      username,
      role,
      status: profile.status,
    };


    /* =====================================================
       CONTINUE
       ===================================================== */

    next();

  } catch (error) {

    console.error(
      "Auth middleware error:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Authentication service error",
      code:
        "AUTH_SERVICE_ERROR",
    });

  }

}


/* =========================================================
   REQUIRE AUTH
   ========================================================= */

export const requireAuth =
  authMiddleware;


/* =========================================================
   REQUIRE ADMIN
   ========================================================= */

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {

  if (!req.user) {

    res.status(401).json({
      success: false,
      message:
        "Authentication required",
      code:
        "AUTH_REQUIRED",
    });

    return;
  }


  if (
    req.user.role !== "admin"
  ) {

    res.status(403).json({
      success: false,
      message:
        "Administrator access required",
      code:
        "ADMIN_REQUIRED",
    });

    return;
  }


  next();

}