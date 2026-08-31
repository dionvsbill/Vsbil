import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { supabase } from "../config/supabase.js";
import { requireAdmin, requireIdentity } from "../middleware/authMiddleware.js";

const router = Router();
const MAX_IMAGES = 5;
const CACHE_HOURS = 6;
const moneyFromText = (value: string | null): number | null => {
  if (!value) return null;
  const cleaned = value.replace(/[^0-9.,]/g, "").replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const text = (value: unknown, max = 5000) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

function validJumiaUrl(raw: unknown): URL | null {
  try {
    const url = new URL(String(raw ?? ""));
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "www.jumia.com.gh") return null;
    return url;
  } catch {
    return null;
  }
}

function productKey(url: URL): string {
  const parts = url.pathname.split("/").filter(Boolean);
  return parts.at(-1)?.replace(/\.html?$/i, "") || crypto.createHash("sha256").update(url.toString()).digest("hex").slice(0, 24);
}

function meta(html: string, property: string): string | null {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
  return pattern.exec(html)?.[1] ?? null;
}

function elementText(html: string, selector: string): string | null {
  const pattern = new RegExp(`<[^>]+(?:${selector})[^>]*>([^<]{1,300})<`, "i");
  return pattern.exec(html)?.[1]?.trim() ?? null;
}

function absoluteImage(value: string): string | null {
  try {
    const url = new URL(value.replace(/&amp;/g, "&"), "https://www.jumia.com.gh");
    if (!/^https?:$/i.test(url.protocol)) return null;
    return url.toString().replace(/_300x300(?=\.[a-z0-9]+(?:\?|$))/i, "_1000x1000");
  } catch {
    return null;
  }
}

function extractImages(html: string): string[] {
  const values: string[] = [];
  const add = (value: string) => {
    const image = absoluteImage(value);
    if (image && !values.includes(image)) values.push(image);
  };
  const attributePattern = /(?:data-src|data-image|src|href)=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = attributePattern.exec(html)) && values.length < MAX_IMAGES) {
    if (/jumia|jcdn|image/i.test(match[1])) add(match[1]);
  }
  const jsonImagePattern = /https?:\/\/[^"'\s\\]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s\\]+)?/gi;
  while ((match = jsonImagePattern.exec(html)) && values.length < MAX_IMAGES) add(match[0]);
  return values.slice(0, MAX_IMAGES);
}

function extractPrice(html: string, original = false): number | null {
  const candidates = original
    ? [meta(html, "product:original_price"), meta(html, "og:original_price"), elementText(html, "old-price"), elementText(html, "oldPrice"), elementText(html, "-old")]
    : [meta(html, "product:price:amount"), meta(html, "og:price:amount"), elementText(html, "class=[^>]*prc"), elementText(html, "data-price")];
  for (const candidate of candidates) {
    const n = moneyFromText(candidate);
    if (n !== null) return n;
  }
  const priceMatch = html.match(/(?:class=["'][^"']*prc[^"']*["'][^>]*>)([^<]+)/i);
  return moneyFromText(priceMatch?.[1] ?? null);
}

function extractProduct(html: string, sourceUrl: string) {
  const title = text(elementText(html, "<h1") || meta(html, "og:title") || meta(html, "title"), 300);
  const description = text(meta(html, "description") || meta(html, "og:description") || elementText(html, "description"), 5000);
  const price = extractPrice(html);
  const originalPrice = extractPrice(html, true);
  const images = extractImages(html);
  const inStock = !/(out of stock|currently unavailable|not available)/i.test(html);
  return { title, description, shortDescription: description.slice(0, 280), price, originalPrice, images, inStock, sourceUrl, currency: "GHS" };
}

router.post("/", requireIdentity, requireAdmin, async (req: Request, res: Response) => {
  try {
    const url = validJumiaUrl(req.body?.url);
    if (!url) return res.status(400).json({ success: false, message: "Only https://www.jumia.com.gh product links are supported." });
    const key = productKey(url);
    const { data: cached } = await supabase.from("jumia_import_cache").select("payload,expires_at").eq("product_key", key).maybeSingle();
    if (cached && new Date(cached.expires_at) > new Date()) return res.json({ success: true, cached: true, product: cached.payload });

    const response = await fetch(url, { headers: { "User-Agent": "VSBIL Commerce Importer/1.0", Accept: "text/html,application/xhtml+xml" }, redirect: "follow" });
    if (!response.ok) return res.status(502).json({ success: false, message: `Jumia returned HTTP ${response.status}.` });
    const html = await response.text();
    const product = extractProduct(html, url.toString());
    if (!product.title || product.price === null) return res.status(422).json({ success: false, message: "The product details could not be extracted reliably." });
    const expiresAt = new Date(Date.now() + CACHE_HOURS * 60 * 60 * 1000).toISOString();
    await supabase.from("jumia_import_cache").upsert({ product_key: key, source_url: url.toString(), payload: product, expires_at: expiresAt }, { onConflict: "product_key" });
    return res.json({ success: true, cached: false, product });
  } catch (error) {
    console.error("Jumia import", error);
    return res.status(500).json({ success: false, message: "Unable to import the Jumia product." });
  }
});

router.post("/publish", requireIdentity, requireAdmin, async (req: Request, res: Response) => {
  try {
    const sourceUrl = validJumiaUrl(req.body?.sourceUrl);
    const title = text(req.body?.title, 300);
    const description = text(req.body?.description, 5000);
    const images = Array.isArray(req.body?.images) ? req.body.images.map((v: unknown) => String(v)).filter((v: string) => /^https?:\/\//i.test(v)).slice(0, MAX_IMAGES) : [];
    const price = moneyFromText(String(req.body?.price ?? ""));
    if (!sourceUrl || !title || price === null) return res.status(400).json({ success: false, message: "A valid Jumia source, title and price are required." });
    const affiliateLink = sourceUrl.toString();
    const { data, error } = await supabase.from("business_products").insert({ name: title, description, price, images, affiliate_link: affiliateLink, source: "jumia", source_url: sourceUrl.toString(), status: "active" }).select().single();
    if (error) return res.status(400).json({ success: false, message: error.message });
    return res.status(201).json({ success: true, product: data });
  } catch (error) {
    console.error("Jumia publish", error);
    return res.status(500).json({ success: false, message: "Unable to publish the imported product." });
  }
});

export const cronRouter = Router();
cronRouter.post("/sync-jumia-prices", async (req: Request, res: Response) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers["x-cron-secret"] !== secret) return res.status(401).json({ success: false, message: "Unauthorized" });
  return res.json({ success: true, message: "Jumia price sync endpoint is protected and ready." });
});

export default router;
