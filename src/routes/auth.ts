import { Router } from "express";
import type { Request, Response } from "express";
import crypto from "node:crypto";
import { supabase } from "../config/supabase.js";

const router = Router();


/* =========================================================
   CONSTANTS
   ========================================================= */

const MAX_PASSWORD_LENGTH = 72;


/* =========================================================
   REGISTRATION SCHEMA
   ========================================================= */

function validateRegister(body: any): { ok: true; data: any } | { ok: false; errors: Record<string,string[]> } {
  const errors: Record<string,string[]> = {};
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const referralCode = typeof body?.referralCode === "string" ? body.referralCode.trim() : undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) errors.email=["Enter a valid email address"];
  if (password.length < 8 || password.length > MAX_PASSWORD_LENGTH) errors.password=["Password must be 8–72 characters"];
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) errors.username=["Username must be 3–30 letters, numbers or underscores"];
  if (referralCode && referralCode.length > 50) errors.referralCode=["Referral code is too long"];
  return Object.keys(errors).length ? {ok:false,errors} : {ok:true,data:{email,password,username,referralCode}};
}
function validateLogin(body: any): { ok: true; data: any } | { ok: false; errors: Record<string,string[]> } {
  const errors: Record<string,string[]> = {}; const email=typeof body?.email === "string" ? body.email.trim() : ""; const password=typeof body?.password === "string" ? body.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>255) errors.email=["Enter a valid email address"];
  if (!password || password.length>MAX_PASSWORD_LENGTH) errors.password=["Invalid password"];
  return Object.keys(errors).length ? {ok:false,errors} : {ok:true,data:{email,password}};
}

/* =========================================================
   REGISTER
   POST /api/auth/register
   ========================================================= */

router.post(
  "/register",
  async (
    req: Request,
    res: Response
  ) => {

    try {

      /* =====================================================
         VALIDATE REQUEST
         ===================================================== */

      const result = validateRegister(req.body);


      if (!result.ok) {

        return res.status(400).json({
          success: false,
          message:
            "Invalid registration details",
          errors: result.errors,
        });

      }


      const {
        email,
        password,
        username,
        referralCode,
      } = result.data;


      /* =====================================================
         NORMALIZE DATA
         ===================================================== */

      const normalizedEmail =
        email
          .toLowerCase()
          .trim();


      const normalizedUsername =
        username
          .toLowerCase()
          .trim();


      const normalizedReferralCode =
        referralCode
          ?.trim()
          .toUpperCase();


      /* =====================================================
         CHECK USERNAME
         ===================================================== */

      const {
        data: existingUsername,
        error: usernameError,
      } =
        await supabase
          .from("users")
          .select("id")
          .eq(
            "username",
            normalizedUsername
          )
          .maybeSingle();


      if (usernameError) {

        console.error(
          "Username check failed:",
          usernameError
        );


        return res.status(500).json({
          success: false,
          message:
            "Unable to check username",
        });

      }


      if (existingUsername) {

        return res.status(409).json({
          success: false,
          message:
            "Username is already taken",
          code:
            "USERNAME_TAKEN",
        });

      }


      /* =====================================================
         CHECK WHETHER EMAIL ALREADY EXISTS
         ===================================================== */

      /*
       * We check our Vsbil users table first.
       *
       * This prevents duplicate Vsbil profiles.
       */

      const {
        data: existingEmail,
        error: existingEmailError,
      } =
        await supabase
          .from("users")
          .select("id")
          .eq(
            "email",
            normalizedEmail
          )
          .maybeSingle();


      if (existingEmailError) {

        console.error(
          "Email check failed:",
          existingEmailError
        );


        return res.status(500).json({
          success: false,
          message:
            "Unable to check email",
        });

      }


      if (existingEmail) {

        return res.status(409).json({
          success: false,
          message:
            "An account with this email already exists",
          code:
            "EMAIL_ALREADY_EXISTS",
        });

      }


      /* =====================================================
         FIND REFERRER
         ===================================================== */

      let referrerId:
        string | null = null;


      if (
        normalizedReferralCode
      ) {

        const {
          data: referrer,
          error: referrerError,
        } =
          await supabase
            .from("users")
            .select("id")
            .eq(
              "referral_code",
              normalizedReferralCode
            )
            .maybeSingle();


        if (referrerError) {

          console.error(
            "Referral lookup failed:",
            referrerError
          );


          return res.status(500).json({
            success: false,
            message:
              "Unable to process referral",
          });

        }


        if (!referrer) {

          return res.status(400).json({
            success: false,
            message:
              "Invalid referral code",
            code:
              "INVALID_REFERRAL_CODE",
          });

        }


        referrerId =
          referrer.id;

      }


      /* =====================================================
         CREATE SUPABASE AUTH USER
         ===================================================== */

      /*
       * IMPORTANT
       *
       * Email confirmation is intentionally enabled
       * automatically for this version.
       *
       * Therefore the user can immediately log in
       * without waiting for a confirmation email.
       *
       * Your Vsbil activation system is still separate:
       *
       * Supabase Auth
       *       ↓
       * Login authentication
       *
       * Vsbil users.status
       *       ↓
       * Payment activation
       */

      const {
        data: authData,
        error: authError,
      } =
        await supabase.auth.admin.createUser({
          email:
            normalizedEmail,

          password,

          email_confirm:
            true,
        });


      if (
        authError ||
        !authData.user
      ) {

        console.error(
          "Auth registration failed:",
          authError
        );


        return res.status(400).json({
          success: false,
          message:
            authError?.message ||
            "Unable to create account",
          code:
            authError?.code ||
            "AUTH_REGISTRATION_FAILED",
        });

      }


      /* =====================================================
         AUTH USER ID
         ===================================================== */

      const userId =
        authData.user.id;


      /* =====================================================
         GENERATE UNIQUE REFERRAL CODE
         ===================================================== */

      const generatedReferralCode =
        `VSBIL-${crypto
          .randomUUID()
          .replace(/-/g, "")
          .slice(0, 10)
          .toUpperCase()}`;


      /* =====================================================
         CREATE VSBIL PROFILE
         ===================================================== */

      const {
        data: profile,
        error: profileError,
      } =
        await supabase
          .from("users")
          .insert({
            id:
              userId,

            email:
              normalizedEmail,

            username:
              normalizedUsername,

            role:
              "user",

            /*
             * IMPORTANT:
             *
             * Registration does NOT activate
             * the Vsbil account.
             *
             * Payment activation changes this
             * from pending → active.
             */

            status:
              "pending",

            referral_code:
              generatedReferralCode,

            referred_by:
              referrerId,
          })
          .select(
            `
              id,
              email,
              username,
              role,
              status,
              referral_code,
              referred_by,
              created_at
            `
          )
          .single();


      if (
        profileError ||
        !profile
      ) {

        console.error(
          "Profile creation failed:",
          profileError
        );


        /*
         * Roll back the Supabase Auth account.
         */

        try {

          await supabase.auth.admin.deleteUser(
            userId
          );

        } catch (deleteError) {

          console.error(
            "Auth rollback failed:",
            deleteError
          );

        }


        return res.status(500).json({
          success: false,
          message:
            "Unable to complete account creation",
          code:
            "PROFILE_CREATION_FAILED",
        });

      }


      /* =====================================================
         CREATE AN AUTH SESSION FOR ACTIVATION
         ===================================================== */
      let session: any = null;
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
      if (supabaseUrl && supabaseAnonKey) {
        const signIn = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
          method: "POST", headers: { "Content-Type": "application/json", apikey: supabaseAnonKey },
          body: JSON.stringify({ email: normalizedEmail, password })
        });
        const authSession: any = await signIn.json().catch(() => null);
        if (signIn.ok && authSession?.access_token) session = { accessToken: authSession.access_token, refreshToken: authSession.refresh_token, expiresIn: authSession.expires_in, expiresAt: authSession.expires_at, tokenType: authSession.token_type || "bearer" };
      }

      /* =====================================================
         REGISTRATION SUCCESS
         ===================================================== */

      return res.status(201).json({
        success: true,

        message:
          "Account created. Activation is required.",

        user: {
          id:
            profile.id,

          email:
            profile.email,

          username:
            profile.username,

          role:
            profile.role,

          status:
            profile.status,

          referralCode: profile.referral_code,
        },
        session,
      });

    } catch (error) {

      console.error(
        "Registration error:",
        error
      );


      return res.status(500).json({
        success: false,
        message:
          "Something went wrong",
        code:
          "REGISTRATION_ERROR",
      });

    }

  }
);


/* =========================================================
   LOGIN
   POST /api/auth/login
   ========================================================= */

router.post(
  "/login",
  async (
    req: Request,
    res: Response
  ) => {

    try {

      /* =====================================================
         VALIDATE REQUEST
         ===================================================== */

      const result = validateLogin(req.body);


      if (!result.ok) {

        return res.status(400).json({
          success: false,
          message:
            "Invalid email or password",
          code:
            "INVALID_LOGIN_DETAILS",
        });

      }


      const {
        email,
        password,
      } = result.data;


      const normalizedEmail =
        email
          .toLowerCase()
          .trim();


      /* =====================================================
         SUPABASE AUTH CONFIG
         ===================================================== */

      const supabaseUrl =
        process.env.SUPABASE_URL;


      const supabaseAnonKey =
        process.env.SUPABASE_ANON_KEY;


      if (
        !supabaseUrl ||
        !supabaseAnonKey
      ) {

        console.error(
          "Supabase Auth environment variables are missing"
        );


        return res.status(500).json({
          success: false,
          message:
            "Authentication service is not configured",
          code:
            "AUTH_CONFIG_MISSING",
        });

      }


      /* =====================================================
         AUTHENTICATE PASSWORD
         ===================================================== */

      const authResponse =
        await fetch(
          `${supabaseUrl}/auth/v1/token?grant_type=password`,
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",

              apikey:
                supabaseAnonKey,
            },

            body:
              JSON.stringify({
                email:
                  normalizedEmail,

                password,
              }),
          }
        );


      /* =====================================================
         READ AUTH RESPONSE
         ===================================================== */

      let authData:
        any;


      try {

        authData =
          await authResponse.json();

      } catch {

        console.error(
          "Supabase returned invalid JSON"
        );


        return res.status(502).json({
          success: false,
          message:
            "Authentication service returned an invalid response",
          code:
            "AUTH_INVALID_RESPONSE",
        });

      }


      /* =====================================================
         SUPABASE AUTH FAILURE
         ===================================================== */

      if (
        !authResponse.ok ||
        !authData?.access_token ||
        !authData?.user
      ) {

        console.error(
          "Login failed:",
          authData
        );


        /*
         * EMAIL NOT CONFIRMED
         *
         * This should no longer happen for NEW users
         * because registration now uses:
         *
         * email_confirm: true
         *
         * Existing users that were created earlier with
         * email_confirm:false may still have this problem.
         */

        if (
          authData?.error_code ===
          "email_not_confirmed"
        ) {

          return res.status(403).json({
            success: false,
            message:
              "Your email has not been confirmed.",
            code:
              "EMAIL_NOT_CONFIRMED",
          });

        }


        return res.status(401).json({
          success: false,
          message:
            authData?.error_description ||
            authData?.msg ||
            "Invalid email or password",
          code:
            "INVALID_CREDENTIALS",
        });

      }


      /* =====================================================
         AUTH USER
         ===================================================== */

      const authUser =
        authData.user;


      const userId =
        authUser.id;


      /* =====================================================
         LOAD VSBIL PROFILE
         ===================================================== */

      const {
        data: user,
        error: userError,
      } =
        await supabase
          .from("users")
          .select(
            `
              id,
              email,
              username,
              status,
              role,
              referral_code,
              referred_by,
              created_at,
              updated_at
            `
          )
          .eq(
            "id",
            userId
          )
          .maybeSingle();


      if (userError) {

        console.error(
          "User profile lookup failed:",
          userError
        );


        return res.status(500).json({
          success: false,
          message:
            "Unable to load your Vsbil account",
          code:
            "PROFILE_LOOKUP_FAILED",
        });

      }


      /* =====================================================
         PROFILE NOT FOUND
         ===================================================== */

      if (!user) {

        console.error(
          "Supabase Auth user exists but Vsbil profile does not:",
          userId
        );


        return res.status(403).json({
          success: false,
          message:
            "Your Vsbil profile could not be found",
          code:
            "PROFILE_NOT_FOUND",
        });

      }


      /* =====================================================
         VERIFY AUTH EMAIL
         ===================================================== */

      const authenticatedEmail =
        authUser.email;


      if (
        typeof authenticatedEmail !==
          "string" ||
        !authenticatedEmail
      ) {

        return res.status(401).json({
          success: false,
          message:
            "Authenticated email is missing",
          code:
            "EMAIL_MISSING",
        });

      }


      /* =====================================================
         VERIFY PROFILE EMAIL
         ===================================================== */

      if (
        typeof user.email !==
          "string" ||
        !user.email
      ) {

        console.error(
          "Vsbil profile email is missing:",
          userId
        );


        return res.status(500).json({
          success: false,
          message:
            "Your account email is missing",
          code:
            "PROFILE_EMAIL_MISSING",
        });

      }


      if (
        user.email.toLowerCase() !==
        authenticatedEmail.toLowerCase()
      ) {

        console.error(
          "Auth/profile email mismatch:",
          {
            userId,
            authEmail:
              authenticatedEmail,
            profileEmail:
              user.email,
          }
        );


        return res.status(401).json({
          success: false,
          message:
            "Account authentication mismatch",
          code:
            "EMAIL_MISMATCH",
        });

      }


      /* =====================================================
         CHECK VSBIL ACCOUNT STATUS
         ===================================================== */

      if (
        user.status !==
        "active"
      ) {

        return res.status(403).json({
          success: false,

          message:
            "Your account has not been activated yet.",

          code:
            "ACCOUNT_NOT_ACTIVE",

          user: {
            id:
              user.id,

            email:
              user.email,

            username:
              user.username,

            status:
              user.status,
          },
        });

      }


      /* =====================================================
         LOGIN SUCCESS
         ===================================================== */

      return res.status(200).json({
        success: true,

        message:
          "Login successful",

        session: {

          accessToken:
            authData.access_token,

          refreshToken:
            authData.refresh_token,

          expiresIn:
            authData.expires_in,

          expiresAt:
            authData.expires_at,

          tokenType:
            authData.token_type ||
            "bearer",

        },

        user: {

          id:
            user.id,

          email:
            user.email,

          username:
            user.username,

          status:
            user.status,

          role:
            user.role,

          referralCode:
            user.referral_code,

        },

      });

    } catch (error) {

      console.error(
        "Login error:",
        error
      );


      return res.status(500).json({
        success: false,
        message:
          "Something went wrong",
        code:
          "LOGIN_ERROR",
      });

    }

  }
);


/* =========================================================
   LOGOUT
   POST /api/auth/logout
   =========================================================
   
   The actual Supabase JWT is held by the browser.
   The dashboard clears it after this request.

   We intentionally do not require the middleware here,
   because logout must still work when the access token
   has expired.
   ========================================================= */

router.post(
  "/logout",
  async (
    _req: Request,
    res: Response
  ) => {

    try {

      /*
       * There is no server-side Vsbil session to destroy.
       *
       * The browser owns the Supabase access/refresh tokens.
       *
       * The frontend clears those tokens immediately
       * after receiving this response.
       */

      return res.status(200).json({
        success: true,
        message:
          "Logged out successfully",
      });

    } catch (error) {

      console.error(
        "Logout error:",
        error
      );


      /*
       * Even if something unexpected happens,
       * the frontend can safely clear its tokens.
       */

      return res.status(200).json({
        success: true,
        message:
          "Logged out successfully",
      });

    }

  }
);


/* =========================================================
   SESSION CHECK
   GET /api/auth/status
   =========================================================
   
   Lightweight public endpoint useful for debugging.
   It does NOT expose private user information.
   ========================================================= */

router.get(
  "/status",
  async (
    _req: Request,
    res: Response
  ) => {

    return res.status(200).json({
      success: true,
      service:
        "Vsbil authentication",
      status:
        "online",
    });

  }
);


/* =========================================================
   EXPORT
   ========================================================= */

export default router;