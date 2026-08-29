import { Router, type Request, type Response } from "express";

const router = Router();

router.get("/google", async (_req: Request, res: Response) => {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const appUrl = process.env.APP_URL?.replace(/\/$/, "");
  if (!supabaseUrl || !appUrl) {
    return res.status(503).json({ success: false, message: "Google authentication is not configured", code: "GOOGLE_AUTH_NOT_CONFIGURED" });
  }

  const redirectTo = `${appUrl}/auth-callback.html`;
  const url = `${supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
  return res.json({ success: true, url });
});

export default router;
