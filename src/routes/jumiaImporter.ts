import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { supabase } from "../config/supabase.js";
import { requireAuth, requireAdmin } from "../middleware/authMiddleware.js";

const router = Router();
const JUMIA_HOSTS = new Set(["jumia.com.gh", "www.jumia.com.gh"]);
const CACHE_HOURS = 6;
const MAX_IMAGES = 5;
const FETCH_TIMEOUT_MS = 12_000;
const CRON_SECRET = process.env.CRON_SECRET?.trim() || "";

type ImportedProduct = {
  title: string;
  description: string;
  shortDescription: string;
  price: number;
  originalPrice: number | null;
  images: string[];
  inStock: boolean;
  sourceUrl: string;
  currency: "GHS";
  productId: string;
};

const clean = (value: unknown, max = 5000): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

function validJumiaUrl(value: unknown): URL | null {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:") return null;
    if (!JUMIA_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url;
  } catch {
    return null;
  }
}

function productIdFromUrl(url: URL): string {
  const path = decodeURIComponent(url.pathname);
  const numericMatches = path.match(/[0-9]{6,}/g);
  return numericMatches?.at(-1) || crypto.createHash("sha256").update(url.toString()).digest("hex").slice(0, 32);
}

function htmlDecode(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;|&#47;/gi, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function meta(html: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return htmlDecode(match[1]);
  }
  return "";
}

function elementText(html: string, selectorHint: string): string {
  const pattern = new RegExp(`<[^>]*${selectorHint}[^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i");
  const match = html.match(pattern);
  return match?.[1] ? htmlDecode(match[1].replace(/<[^>]+>/g, " ")) : "";
}

function moneyFromText(value: string): number | null {
  const cleaned = value.replace(/[^0-9.,]/g, "").replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function absoluteImage(raw: string): string | null {
  const value = htmlDecode(raw).replace(/\\u002F/g, "/").trim();
  if (!value || value.startsWith("data:")) return null;
  try {
    const url = new URL(value, "https://www.jumia.com.gh");
    if (url.protocol !== "https:") return null;
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
  return priceMatch?.[1] ? moneyFromText(priceMatch[1]) : null;
}

function extractStock(html: string): boolean {
  const text = htmlDecode(html.replace(/<[^>]+>/g, " ")).toLowerCase();
  if (/out of stock|currently unavailable|sold out|not available/.test(text)) return false;
  if (/in stock|available|add to cart|buy now/.test(text)) return true;
  return true;
}

async function fetchProduct(sourceUrl: string): Promise<ImportedProduct> {
  const url = validJumiaUrl(sourceUrl);
  if (!url) throw new Error("Only secure Jumia Ghana product links are supported");
  const productId = productIdFromUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "VSBIL Product Importer/1.0 (+https://vsbil.onrender.com)" },
    });
    if (!response.ok) throw new Error(`Jumia returned HTTP ${response.status}`);
    const html = await response.text();
    if (html.length < 500) throw new Error("Jumia returned an incomplete product page");
    const title = meta(html, "og:title") || elementText(html, "<h1") || meta(html, "twitter:title");
    const description = meta(html, "og:description") || meta(html, "description") || elementText(html, "description");
    const price = extractPrice(html, false);
    const originalPrice = extractPrice(html, true);
    if (!title || price === null) throw new Error("Could not reliably extract the product title and price from Jumia");
    const images = extractImages(html);
    return { title: title.slice(0, 250), description: description.slice(0, 5000), shortDescription: description.slice(0, 300), price, originalPrice: originalPrice && originalPrice > price ? originalPrice : null, images, inStock: extractStock(html), sourceUrl: url.toString(), currency: "GHS", productId };
  } finally { clearTimeout(timeout); }
}

async function cachedProduct(sourceUrl: string): Promise<ImportedProduct> {
  const url = validJumiaUrl(sourceUrl);
  if (!url) throw new Error("Only secure Jumia Ghana product links are supported");
  const productId = productIdFromUrl(url);
  const { data: cached } = await supabase.from("jumia_import_cache").select("payload,fetched_at").eq("product_id", productId).maybeSingle();
  if (cached?.payload && cached.fetched_at && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_HOURS * 60 * 60 * 1000) return cached.payload as ImportedProduct;
  const product = await fetchProduct(url.toString());
  await supabase.from("jumia_import_cache").upsert({ product_id: productId, source_url: product.sourceUrl, payload: product, fetched_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "product_id" });
  return product;
}

function officialAffiliateUrl(sourceUrl: string, tag: string): string { const url = new URL(sourceUrl); if (tag) url.searchParams.set("kol_id", tag); return url.toString(); }

router.get("/shops", requireAuth, requireAdmin, async (_req, res) => { const { data, error } = await supabase.from("business_shops").select("id,name,store_slug,is_published").order("created_at", { ascending: false }).limit(100); if (error) return res.status(500).json({ success: false, message: "Unable to load shops" }); return res.json({ success: true, shops: data ?? [] }); });

router.post("/fetch", requireAuth, requireAdmin, async (req, res) => { try { const sourceUrl = clean(req.body?.url, 2000); if (!validJumiaUrl(sourceUrl)) return res.status(400).json({ success: false, message: "Paste a valid HTTPS Jumia Ghana product link" }); const product = await cachedProduct(sourceUrl); return res.json({ success: true, product, cachedForHours: CACHE_HOURS }); } catch (error) { console.error("Jumia import fetch", error); return res.status(502).json({ success: false, message: error instanceof Error ? error.message : "Unable to fetch Jumia product" }); } });

router.post("/publish", requireAuth, requireAdmin, async (req, res) => { try { const shopId = clean(req.body?.shopId, 80); const sourceUrl = clean(req.body?.sourceUrl, 2000); const title = clean(req.body?.title, 250); const description = clean(req.body?.description, 5000); const images = Array.isArray(req.body?.images) ? req.body.images.filter((x: unknown): x is string => typeof x === "string").map((x: string) => absoluteImage(x)).filter((x): x is string => Boolean(x)).slice(0, MAX_IMAGES) : []; const price = Number(req.body?.price); const originalPrice = req.body?.originalPrice == null ? null : Number(req.body.originalPrice); const affiliateTag = clean(req.body?.affiliateTag, 100); if (!shopId || !validJumiaUrl(sourceUrl) || !title || !Number.isFinite(price) || price < 0 || !images.length) return res.status(400).json({ success: false, message: "Shop, source URL, title, price and at least one image are required" }); const { data: shop } = await supabase.from("business_shops").select("id,name,affiliate_link").eq("id", shopId).eq("user_id", req.user!.id).maybeSingle(); if (!shop) return res.status(404).json({ success: false, message: "Official shop not found" }); const sourceId = productIdFromUrl(new URL(sourceUrl)); const affiliateLink = shop.affiliate_link || officialAffiliateUrl(sourceUrl, affiliateTag || process.env.VSBIL_JUMIA_KOL_ID?.trim() || ""); const payload = { id: crypto.randomUUID(), user_id: req.user!.id, shop_id: shop.id, name: title, sku: `JUMIA-${sourceId}`.slice(0, 80), description, image_url: images[0], image_urls: images, selling_price: Math.round(price * 100) / 100, original_price: Number.isFinite(originalPrice) && Number(originalPrice) > price ? Number(originalPrice) : null, discount_percent: Number.isFinite(originalPrice) && Number(originalPrice) > price ? Math.min(100, Math.max(0, Math.round((1 - price / Number(originalPrice)) * 10000) / 100)) : 0, quantity: 0, unit: "piece", is_published: true, source: "jumia", source_url: sourceUrl, source_product_id: sourceId, source_currency: "GHS", source_in_stock: Boolean(req.body?.inStock), last_synced_at: new Date().toISOString(), affiliate_link: affiliateLink || null }; const { data, error } = await supabase.from("inventory_products").upsert(payload, { onConflict: "shop_id,source,source_product_id" }).select().single(); if (error) return res.status(400).json({ success: false, message: error.message }); return res.status(201).json({ success: true, product: data }); } catch (error) { console.error("Jumia publish", error); return res.status(500).json({ success: false, message: "Unable to publish imported product" }); } });

async function syncPrices(): Promise<{ scanned: number; updated: number; failed: number }> { const { data: products, error } = await supabase.from("inventory_products").select("id,source_url,source_product_id,selling_price,original_price").eq("source", "jumia").not("source_url", "is", null).limit(1000); if (error) throw error; let updated = 0; let failed = 0; for (const product of products ?? []) { try { const imported = await cachedProduct(String(product.source_url)); const patch = { selling_price: imported.price, original_price: imported.originalPrice, source_in_stock: imported.inStock, last_synced_at: new Date().toISOString(), image_url: imported.images[0] || null, image_urls: imported.images }; const { error: updateError } = await supabase.from("inventory_products").update(patch).eq("id", product.id).eq("source", "jumia"); if (updateError) throw updateError; updated += 1; } catch (error) { failed += 1; console.error("Jumia price sync failed", product.id, error); } } return { scanned: products?.length ?? 0, updated, failed }; }

router.post("/sync", requireAuth, requireAdmin, async (_req, res) => { try { return res.json({ success: true, result: await syncPrices() }); } catch (error) { console.error("Jumia manual sync", error); return res.status(500).json({ success: false, message: "Unable to sync Jumia products" }); } });

export const cronRouter = Router();
cronRouter.post("/sync-jumia-prices", async (req: Request, res: Response) => { if (!CRON_SECRET || req.header("x-cron-secret") !== CRON_SECRET) return res.status(401).json({ success: false, message: "Unauthorized" }); try { return res.json({ success: true, result: await syncPrices() }); } catch (error) { console.error("Jumia cron sync", error); return res.status(500).json({ success: false, message: "Jumia price sync failed" }); } });

export default router;
