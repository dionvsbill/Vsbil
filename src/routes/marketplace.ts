import { Router, type Request, type Response } from "express";
import { supabase } from "../config/supabase.js";

const router = Router();
const text = (value: unknown, max = 120): string => typeof value === "string" ? value.trim().slice(0, max) : "";

router.get("/shops", async (req: Request, res: Response) => {
  try {
    const q = text(req.query.q, 120);
    let shopQuery = supabase.from("business_shops")
      .select("id,name,description,logo_url,phone,address,currency,store_slug,is_published,created_at")
      .eq("is_published", true).order("created_at", { ascending: false }).limit(60);
    if (q) shopQuery = shopQuery.or(`name.ilike.%${q}%,description.ilike.%${q}%`);
    const { data: shops, error: shopError } = await shopQuery;
    if (shopError) throw shopError;
    const shopIds = (shops ?? []).map((shop) => shop.id);
    if (!shopIds.length) return res.json({ success: true, shops: [], products: [] });
    const { data: products, error: productError } = await supabase.from("inventory_products")
      .select("id,shop_id,name,sku,description,image_url,selling_price,discount_percent,quantity,unit,updated_at")
      .in("shop_id", shopIds).eq("is_published", true).order("updated_at", { ascending: false }).limit(180);
    if (productError) throw productError;
    const normalizedProducts = (products ?? []).map((product) => {
      const discount = Math.min(Math.max(Number(product.discount_percent) || 0, 0), 100);
      return { ...product, available: Number(product.quantity) > 0, sale_price: Math.round(Number(product.selling_price) * (1 - discount / 100) * 100) / 100 };
    });
    return res.json({ success: true, shops: shops ?? [], products: normalizedProducts });
  } catch (error) {
    console.error("Marketplace catalog", error);
    return res.status(500).json({ success: false, message: "Unable to load marketplace" });
  }
});
export default router;
