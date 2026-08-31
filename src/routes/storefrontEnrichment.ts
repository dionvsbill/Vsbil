import { Router, type Request, type Response } from "express";
import { supabase } from "../config/supabase.js";

const router = Router();
const slugify = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);

/*
 * This route intentionally sits before the legacy storefront route. It keeps
 * the existing checkout/RPC implementation untouched while adding the newer
 * gallery + affiliate fields to the public catalog response.
 */
router.get("/store/:slug", async (req: Request, res: Response, next: (error?: unknown) => void) => {
  try {
    const storeSlug = slugify(String(req.params.slug || ""));
    const { data: shop, error: shopError } = await supabase.from("business_shops").select("id,name,description,logo_url,phone,address,currency,store_slug,whatsapp_bot_id,affiliate_link,affiliate_provider").eq("store_slug", storeSlug).eq("is_published", true).maybeSingle();
    if (shopError) throw shopError;
    if (!shop) return next();
    const { data: products, error } = await supabase.from("inventory_products").select("id,name,sku,description,image_url,image_urls,selling_price,original_price,discount_percent,quantity,unit,affiliate_link,source,source_url,source_in_stock,last_synced_at").eq("shop_id", shop.id).eq("is_published", true).order("name");
    if (error) throw error;
    return res.json({ success: true, shop: { ...shop, whatsapp_bot_id: undefined }, products: (products ?? []).map((product) => { const discount = Math.min(Math.max(Number(product.discount_percent) || 0, 0), 100); const salePrice = Math.round(Number(product.selling_price) * (1 - discount / 100) * 100) / 100; return { ...product, image_urls: Array.isArray(product.image_urls) && product.image_urls.length ? product.image_urls : (product.image_url ? [product.image_url] : []), available: Number(product.quantity) > 0 || product.source_in_stock === true, sale_price: salePrice }; }) });
  } catch (error) {
    console.error("Enriched storefront", error);
    return next(error);
  }
});

export default router;
