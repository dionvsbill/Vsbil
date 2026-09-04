import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { supabase } from "../config/supabase.js";
import crypto from "node:crypto";

const router = Router();
const clean = (v: unknown, max = 5000) => typeof v === "string" ? v.trim().slice(0, max) : "";
function valid(url: string): URL | null { try { const u = new URL(url); return u.protocol === "https:" && ["jumia.com.gh", "www.jumia.com.gh"].includes(u.hostname.toLowerCase()) ? u : null; } catch { return null; } }
function meta(html: string, key: string): string { const e = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); const a = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${e}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i")); const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${e}["'][^>]*>`, "i")); return (a?.[1] || b?.[1] || "").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").trim(); }
function price(html: string): number | null { const v = meta(html,"product:price:amount") || meta(html,"og:price:amount"); const n = Number(v?.replace(/[^0-9.]/g,"")); return Number.isFinite(n) ? Math.round(n*100)/100 : null; }
function images(html: string): string[] { const out: string[] = []; const re = /(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/gi; let m: RegExpExecArray | null; while ((m = re.exec(html)) && out.length < 5) { try { const u = new URL(m[1],"https://www.jumia.com.gh"); if (u.protocol === "https:") out.push(u.toString()); } catch {} } return out; }

router.post("/preview", requireAuth, async (req,res) => {
  const sourceUrl = clean(req.body?.url,2000); const url = valid(sourceUrl);
  if (!url) return res.status(400).json({success:false,message:"Paste a valid HTTPS Jumia Ghana product URL"});
  const controller = new AbortController(); const timer = setTimeout(()=>controller.abort(),12000);
  try {
    const response = await fetch(url.toString(), { signal: controller.signal, headers: { Accept:"text/html,application/xhtml+xml", "User-Agent":"VSBIL Product Importer/1.0" } });
    if (response.status === 401 || response.status === 403) return res.status(502).json({success:false,code:"JUMIA_BLOCKED",requiresManual:true,message:"Jumia is refusing automated access to this product. Enter the product details manually; VSBIL will not bypass that protection."});
    if (!response.ok) return res.status(502).json({success:false,code:"JUMIA_FETCH_FAILED",requiresManual:true,message:`Jumia returned HTTP ${response.status}. You can use manual import.`});
    const html = await response.text(); const title = meta(html,"og:title") || meta(html,"twitter:title"); const description = meta(html,"og:description") || meta(html,"description"); const amount = price(html); if (!title || amount === null) return res.status(422).json({success:false,requiresManual:true,message:"The product page did not expose reliable title/price data. Complete the fields manually."});
    return res.json({success:true,product:{title:title.slice(0,250),description:description.slice(0,5000),price:amount,images:images(html),sourceUrl:url.toString(),currency:"GHS"}});
  } catch (error) { return res.status(502).json({success:false,code:"JUMIA_FETCH_FAILED",requiresManual:true,message:error instanceof Error && error.name === "AbortError" ? "Jumia took too long to respond. Use manual import." : "Unable to import this Jumia page. Use manual import."}); }
  finally { clearTimeout(timer); }
});

router.post("/:shopId/import", requireAuth, async (req,res) => {
  try {
    const { data: shop } = await supabase.from("business_shops").select("id,user_id,jforce_id").eq("id",req.params.shopId).eq("user_id",req.user!.id).maybeSingle();
    if (!shop) return res.status(404).json({success:false,message:"Shop not found"});
    const sourceUrl = clean(req.body?.sourceUrl,2000); if (!valid(sourceUrl)) return res.status(400).json({success:false,message:"A valid Jumia Ghana URL is required"});
    const title = clean(req.body?.title,250), description = clean(req.body?.description,5000); const p = Number(req.body?.price); const markup = Math.min(500,Math.max(-90,Number(req.body?.markupPercent)||0)); const imgs = Array.isArray(req.body?.images) ? req.body.images.filter((x:unknown):x is string=>typeof x === "string").slice(0,5) : [];
    if (!title || !Number.isFinite(p) || p < 0) return res.status(400).json({success:false,message:"Title and valid price are required"});
    const finalPrice = Math.round(p * (1 + markup/100) * 100) / 100; const affiliate = new URL(sourceUrl); if (shop.jforce_id) affiliate.searchParams.set("kol_id",shop.jforce_id);
    const sourceId = crypto.createHash("sha256").update(sourceUrl).digest("hex").slice(0,24);
    const payload = { user_id:req.user!.id, shop_id:shop.id, name:title, sku:`JUMIA-${sourceId}`.slice(0,80), description:description||null, image_url:imgs[0]||null, image_urls:imgs, selling_price:finalPrice, original_price:p, quantity:0, unit:"piece", is_published:false, source:"jumia", source_url:sourceUrl, source_product_id:sourceId, source_currency:"GHS", source_in_stock:true, affiliate_link:affiliate.toString(), updated_at:new Date().toISOString() };
    const {data,error}=await supabase.from("inventory_products").upsert(payload,{onConflict:"shop_id,source,source_product_id"}).select().single(); if(error) throw error; return res.status(201).json({success:true,product:data,affiliateLink:affiliate.toString(),message:"Product imported as a draft. Review it before publishing."});
  } catch(error) { console.error("Shop Jumia import",error); return res.status(500).json({success:false,message:"Unable to import product"}); }
});

export default router;
