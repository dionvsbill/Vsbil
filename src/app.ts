import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import authRouter from "./routes/auth.js";
import paymentRouter from "./routes/payment.js";
import dashboardRouter from "./routes/dashboard.js";
import withdrawalRouter from "./routes/withdrawals.js";
import adminRouter from "./routes/admin.js";
import activityRouter from "./routes/activities.js";
import usersRouter from "./routes/users.js";
import { rateLimit } from "./middleware/rateLimit.js";
/* =========================================================
   VSBIL APPLICATION SERVER
   =========================================================
   Responsibilities:
   - Security middleware
   - CORS
   - JSON parsing
   - Request IDs
   - API route registration
   - Rate limiting
   - Static frontend serving
   - API 404 handling
   - Central error handling
   IMPORTANT:
   Secrets such as Supabase service-role keys must NEVER
   be placed in this file or exposed to the frontend.
========================================================= */
/* =========================================================
   PATH CONFIGURATION
   ========================================================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/* =========================================================
   APPLICATION
   ========================================================= */
const app = express();
/* =========================================================
   ENVIRONMENT
   ========================================================= */
const nodeEnv =
  process.env.NODE_ENV?.trim() || "development";
const allowedOrigin =
  process.env.APP_URL?.trim() || "";
/* =========================================================
   BASIC APPLICATION SECURITY
   ========================================================= */
app.disable("x-powered-by");
/*
 * Trust the first reverse proxy.
 *
 * This is required for environments such as:
 * - GitHub Codespaces
 * - Render
 * - Railway
 * - Fly.io
 * - other reverse-proxy deployments
 */
app.set("trust proxy", 1);
/* =========================================================
   HELMET
   ========================================================= */
app.use(
  helmet({
    /*
     * CSP is disabled here because the current frontend
     * may use inline scripts/styles or external resources.
     *
     * A strict CSP can be introduced later after auditing
     * every frontend resource.
     */
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },
    referrerPolicy: {
      policy: "strict-origin-when-cross-origin",
    },
    frameguard: {
      action: "sameorigin",
    },
  })
);
/* =========================================================
   CORS
   =========================================================
   Production:
     APP_URL should contain the exact frontend origin.
   Development:
     localhost and GitHub Codespaces forwarded domains
     are allowed.
   Examples:
     http://localhost:3000
     http://127.0.0.1:3000
     https://xxxxx-3000.app.github.dev
========================================================= */
app.use(
  cors({
    origin: (origin, callback) => {
      /*
       * Requests without an Origin header are normally:
       * - curl
       * - server-to-server requests
       * - health checks
       *
       * These do not require browser CORS validation.
       */
      if (!origin) {
        return callback(null, true);
      }
      /*
       * Exact configured application origin.
       */
      if (
        allowedOrigin &&
        origin === allowedOrigin
      ) {
        return callback(null, true);
      }
      /*
       * Local development.
       */
      if (
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:")
      ) {
        return callback(null, true);
      }
      /*
       * GitHub Codespaces forwarded ports.
       *
       * Codespaces commonly uses:
       * https://<name>-3000.app.github.dev
       */
      if (
        origin.endsWith(".app.github.dev")
      ) {
        return callback(null, true);
      }
      /*
       * Do not silently allow unknown origins.
       */
      console.warn(
        `[CORS] Blocked origin: ${origin}`
      );
      return callback(
        new Error("CORS origin denied")
      );
    },
    credentials: true,
    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
      "X-Requested-With",
    ],
    exposedHeaders: [
      "X-Request-Id",
    ],
    optionsSuccessStatus: 204,
  })
);
/* =========================================================
   BODY PARSING
   ========================================================= */
app.use(
  express.json({
    limit: "100kb",
  })
);
/* =========================================================
   REQUEST METADATA
   ========================================================= */
app.use(
  (req, res, next) => {
    /*
     * Give every request a lightweight identifier.
     */
    res.setHeader(
      "X-Request-Id",
      cryptoRandomId()
    );
    /*
     * Prevent browser/proxy caching of API responses.
     */
    if (
      req.path.startsWith("/api/")
    ) {
      res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate"
      );
      res.setHeader(
        "Pragma",
        "no-cache"
      );
      res.setHeader(
        "Expires",
        "0"
      );
    }
    next();
  }
);
/* =========================================================
   API ROUTES
   ========================================================= */
/* ---------------- AUTH ---------------- */
app.use(
  "/api/auth",
  rateLimit({
    windowMs: 60_000,
    max: 30,
    key: (req) =>
      `${req.ip}:auth`,
  }),
  authRouter
);
/* ---------------- PAYMENT ---------------- */
app.use(
  "/api/payment",
  rateLimit({
    windowMs: 60_000,
    max: 20,
    key: (req) =>
      `${req.ip}:payment`,
  }),
  paymentRouter
);
/* ---------------- DASHBOARD ---------------- */
app.use(
  "/api/dashboard",
  dashboardRouter
);
/* ---------------- WITHDRAWALS ---------------- */
app.use(
  "/api/withdrawals",
  withdrawalRouter
);
/* ---------------- ACTIVITIES ---------------- */
app.use(
  "/api/activities",
  activityRouter
);
/* ---------------- USERS ---------------- */
app.use(
  "/api/users",
  usersRouter
);
/* ---------------- ADMIN ---------------- */
app.use(
  "/api/admin",
  adminRouter
);
/* =========================================================
   HEALTH CHECK
   ========================================================= */
app.get(
  "/api/health",
  (_req, res) => {
    res.status(200).json({
      success: true,
      service: "VSBIL API",
      status: "online",
      environment: nodeEnv,
      time: new Date().toISOString(),
    });
  }
);
/* =========================================================
   STATIC FRONTEND
   =========================================================
   Compiled server location:
     dist/app.js
   Frontend location:
     public/
   Therefore:
     ../public
========================================================= */
const publicDirectory =
  path.resolve(
    __dirname,
    "../public"
  );
app.use(
  express.static(
    publicDirectory,
    {
      extensions: ["html"],
      /*
       * Do not cache API-like files.
       */
      setHeaders: (res, filePath) => {
        if (
          filePath.includes(
            `${path.sep}public${path.sep}`
          )
        ) {
          res.setHeader(
            "X-Content-Type-Options",
            "nosniff"
          );
        }
      },
    }
  )
);
/* =========================================================
   API 404 HANDLER
   =========================================================
   This must come after all API routes.
========================================================= */
app.all(
  "/api/*splat",
  (_req, res) => {
    res.status(404).json({
      success: false,
      message: "API endpoint not found",
      code: "NOT_FOUND",
    });
  }
);
/* =========================================================
   CENTRAL ERROR HANDLER
   ========================================================= */
app.use(
  (
    error: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(
      "Unhandled application error:",
      error
    );
    /*
     * If headers have already been sent, allow Express
     * to handle the remaining error processing.
     */
    if (res.headersSent) {
      return;
    }
    /*
     * Never expose internal error details to clients.
     */
    const isApiRequest =
      req.path.startsWith("/api/");
    if (isApiRequest) {
      res.status(500).json({
        success: false,
        message:
          "Internal server error",
        code:
          "INTERNAL_ERROR",
        requestId:
          res.getHeader(
            "X-Request-Id"
          ),
      });
      return;
    }
    res.status(500).send(
      "Internal server error"
    );
  }
);
/* =========================================================
   REQUEST ID
   ========================================================= */
function cryptoRandomId(): string {
  return [
    Date.now().toString(36),
    Math.random()
      .toString(36)
      .slice(2, 10),
  ].join("-");
}
/* =========================================================
   EXPORT
   ========================================================= */
export default app;