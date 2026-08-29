import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import authRouter from "./routes/auth.js";
import authAdvancedRouter from "./routes/authAdvanced.js";
import authProductionRouter from "./routes/authProduction.js";
import authProductionPatchRouter from "./routes/authProductionPatch.js";
import paymentRouter from "./routes/payment.js";
import dashboardRouter from "./routes/dashboard.js";
import withdrawalRouter from "./routes/withdrawals.js";
import adminRouter from "./routes/admin.js";
import campaignAdminRouter from "./routes/campaignAdmin.js";
import activityRouter from "./routes/activities.js";
import usersRouter from "./routes/users.js";
import notificationRouter from "./routes/notifications.js";
import youtubeRouter from "./routes/youtube.js";
import verificationRouter from "./routes/verification.js";
import { rateLimit } from "./middleware/rateLimit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const nodeEnv = process.env.NODE_ENV?.trim() || "development";
const allowedOrigin = process.env.APP_URL?.trim().replace(/\/$/, "") || "";
const isProduction = nodeEnv === "production";

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" }, referrerPolicy: { policy: "strict-origin-when-cross-origin" }, frameguard: { action: "sameorigin" }, hsts: isProduction ? undefined : false }));

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const normalized = origin.replace(/\/$/, "");
    if (allowedOrigin && normalized === allowedOrigin) return cb(null, true);
    if (!isProduction && (normalized.startsWith("http://localhost:") || normalized.startsWith("http://127.0.0.1:") || normalized.endsWith(".github.dev"))) return cb(null, true);
    return cb(new Error("CORS origin denied"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept", "X-Requested-With", "X-Idempotency-Key"],
  exposedHeaders: ["X-Request-Id"],
  optionsSuccessStatus: 204,
}));

app.use(express.json({ limit: "100kb", verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); } }));
app.use((req, res, next) => {
  res.setHeader("X-Request-Id", `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  if (req.path.startsWith("/api/")) { res.setHeader("Cache-Control", "no-store"); res.setHeader("Pragma", "no-cache"); }
  next();
});

app.use("/api/auth", rateLimit({ windowMs: 60_000, max: 30, key: req => `${req.ip}:auth` }), authRouter);
app.use("/api/auth/advanced", rateLimit({ windowMs: 60_000, max: 12, key: req => `${req.ip}:advanced-auth` }), authAdvancedRouter);
app.use("/api/auth/production", rateLimit({ windowMs: 60_000, max: 15, key: req => `${req.ip}:production-auth` }));
app.use("/api/auth/production", authProductionPatchRouter);
app.use("/api/auth/production", authProductionRouter);
app.use("/api/payment", rateLimit({ windowMs: 60_000, max: 20, key: req => `${req.ip}:payment` }), paymentRouter);
app.use("/api/youtube", rateLimit({ windowMs: 60_000, max: 20, key: req => `${req.ip}:youtube` }), youtubeRouter);
app.use("/api/verification", rateLimit({ windowMs: 60_000, max: 10, key: req => `${req.ip}:verification` }), verificationRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/withdrawals", withdrawalRouter);
app.use("/api/activities", rateLimit({ windowMs: 60_000, max: 60, key: req => `${req.ip}:activities` }), activityRouter);
app.use("/api/users", usersRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/admin", campaignAdminRouter);
app.use("/api/admin", adminRouter);

app.get("/api/health", async (_req, res) => res.json({ success: true, service: "VSBIL API", status: "online", environment: nodeEnv, time: new Date().toISOString() }));

const publicDirectory = path.resolve(__dirname, "../public");
const injectVsbilHead = (html: string) => {
  const head = html.includes('rel="manifest"') ? "" : `\n<link rel="manifest" href="/manifest.webmanifest">\n<link rel="icon" href="/assets/vsbil-logo.svg" type="image/svg+xml">\n<link rel="apple-touch-icon" href="/assets/vsbil-logo.svg">\n<meta name="theme-color" content="#111827">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n<meta name="apple-mobile-web-app-title" content="VSBIL">\n<link rel="stylesheet" href="/css/brand.css">\n`;
  const script = html.includes("/js/pwa.js") ? "" : `<script src="/js/pwa.js" defer></script>`;
  return html.replace("</head>", `${head}</head>`).replace("</body>", `${script}</body>`);
};
const sendHtmlPage = async (filePath: string, res: express.Response, next: express.NextFunction) => {
  try { const html = await readFile(filePath, "utf8"); res.status(200).type("html").setHeader("X-Content-Type-Options", "nosniff"); res.send(injectVsbilHead(html)); }
  catch (error: any) { if (error?.code === "ENOENT") return next(); return next(error); }
};

app.get("/", (_req, res, next) => sendHtmlPage(path.join(publicDirectory, "index.html"), res, next));
app.get(/^\/.*\.html$/, (req, res, next) => { const relative = req.path.replace(/^\/+/, ""); const safePath = path.normalize(relative); if (safePath.startsWith("..") || path.isAbsolute(safePath)) return res.status(400).end(); return sendHtmlPage(path.join(publicDirectory, safePath), res, next); });
app.use(express.static(publicDirectory, { extensions: ["html"], setHeaders: res => res.setHeader("X-Content-Type-Options", "nosniff") }));
app.all("/api/*splat", (_req, res) => res.status(404).json({ success: false, message: "API endpoint not found", code: "NOT_FOUND" }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled application error", error);
  if (res.headersSent) return;
  const isCors = error instanceof Error && error.message === "CORS origin denied";
  res.status(isCors ? 403 : 500).json({ success: false, message: isCors ? "Origin is not allowed" : "Internal server error", code: isCors ? "CORS_DENIED" : "INTERNAL_ERROR", requestId: res.getHeader("X-Request-Id") });
});

export default app;
