import "dotenv/config";
import app from "./app.js";
import businessCommerceRouter from "./routes/businessCommerce.js";
import businessPaymentsRouter from "./routes/businessPayments.js";
import shopExpansionRouter from "./routes/shopExpansion.js";
import shopJumiaRouter from "./routes/shopJumia.js";
import shopSettingsRouter from "./routes/shopSettings.js";
import shopPublicRouter from "./routes/shopPublic.js";
import shopPaymentsRouter from "./routes/shopPayments.js";

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === "production";
const requiredProduction = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "APP_URL", "APP_ENCRYPTION_KEY", "APP_STATE_SECRET"];
if (isProduction) {
  const missing = requiredProduction.filter(name => !process.env[name]?.trim());
  if (missing.length) throw new Error(`Missing production environment variables: ${missing.join(", ")}`);
}

// Extend the already-mounted routers so the existing /api/* catch-all cannot shadow additions.
businessCommerceRouter.use("/shop", shopExpansionRouter);
businessCommerceRouter.use("/shop-jumia", shopJumiaRouter);
businessCommerceRouter.use("/shop-settings", shopSettingsRouter);
businessCommerceRouter.use("/shop-public", shopPublicRouter);
businessPaymentsRouter.use("/shop", shopPaymentsRouter);

app.get("/dashboard/shop/create", (_req, res) => res.sendFile("shop-create.html", { root: "public" }));
app.get("/dashboard/shop/:id", (_req, res) => res.sendFile("shop-dashboard.html", { root: "public" }));
app.get("/shop/:slug", (_req, res) => res.sendFile("shop-store.html", { root: "public" }));
app.get("/admin/shops", (_req, res) => res.sendFile("shops.html", { root: "public/admin" }));

const server = app.listen(PORT, () => console.log(`VSBIL API listening on port ${PORT}`));

const shutdown = (signal: string) => {
  console.log(`Received ${signal}; shutting down gracefully…`);
  server.close(error => {
    if (error) { console.error("Graceful shutdown failed", error); process.exitCode = 1; }
    process.exit();
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", reason => console.error("Unhandled promise rejection", reason));
process.on("uncaughtException", error => { console.error("Uncaught exception", error); shutdown("uncaughtException"); });