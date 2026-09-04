import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { supabase } from "../config/supabase.js";

const router = Router();
const clean = (v: unknown, max = 2000) => typeof v === "string" ? v.trim().slice(0,max) : "";
const num = (v: unknown) => { const n=Number(v); return Number.isFinite(n) ? Math.max(0,Math.round(n*100)/100) : 0; };

router.get("/:shopId", requireAuth, async (req,res) => {
  const {data,error}=await supabase.from("business_shops").select("id,name,description,logo_url,banner_url,phone,momo_number,address,delivery_fee,jforce_id,store_slug,is_published,shop_status,is_pro,pro_expires_at,whatsapp_bot_id,whatsapp_auto_reply").eq("id",req.params.shopId).eq("user_id",req.user!.id).maybeSingle();
  if(error) return res.status(500).json({success:false,message:"Unable to load shop settings"});
  if(!data) return res.status(404).json({success:false,message:"Shop not found"});
  return res.json({success:true,shop:data});
});

router.patch("/:shopId", requireAuth, async (req,res) => {
  const {data:shop}=await supabase.from("business_shops").select("id").eq("id",req.params.shopId).eq("user_id",req.user!.id).maybeSingle();
  if(!shop) return res.status(404).json({success:false,message:"Shop not found"});
  const patch:Record<string,unknown>={};
  if(req.body?.name!==undefined) patch.name=clean(req.body.name,120);
  if(req.body?.description!==undefined) patch.description=clean(req.body.description,2000)||null;
  if(req.body?.logoUrl!==undefined) patch.logo_url=clean(req.body.logoUrl,1000)||null;
  if(req.body?.bannerUrl!==undefined) patch.banner_url=clean(req.body.bannerUrl,1000)||null;
  if(req.body?.phone!==undefined) patch.phone=clean(req.body.phone,40)||null;
  if(req.body?.momoNumber!==undefined) patch.momo_number=clean(req.body.momoNumber,40)||null;
  if(req.body?.address!==undefined) patch.address=clean(req.body.address,500)||null;
  if(req.body?.deliveryFee!==undefined) patch.delivery_fee=num(req.body.deliveryFee);
  if(req.body?.jforceId!==undefined) patch.jforce_id=clean(req.body.jforceId,100)||null;
  if(req.body?.storeSlug!==undefined){const slug=clean(req.body.storeSlug,70).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");if(slug.length<3)return res.status(400).json({success:false,message:"Store URL must be at least 3 characters"});patch.store_slug=slug;}
  if(req.body?.isPublished!==undefined){if(Boolean(req.body.isPublished)){const {data:plan}=await supabase.from("business_subscriptions").select("status,ends_at").eq("user_id",req.user!.id).eq("product","shop").maybeSingle();const active=plan?.status==="active"&&(!plan.ends_at||new Date(plan.ends_at).getTime()>Date.now());if(!active)return res.status(402).json({success:false,message:"An active Shop plan is required to publish the storefront",code:"SHOP_PLAN_REQUIRED"});}patch.is_published=Boolean(req.body.isPublished);}
  if(Object.keys(patch).length===0)return res.status(400).json({success:false,message:"No settings supplied"});
  const {data,error}=await supabase.from("business_shops").update(patch).eq("id",shop.id).eq("user_id",req.user!.id).select("id,name,description,logo_url,banner_url,phone,momo_number,address,delivery_fee,jforce_id,store_slug,is_published,shop_status,is_pro,pro_expires_at,whatsapp_bot_id,whatsapp_auto_reply").single();
  if(error) return res.status(error.code==="23505"?409:400).json({success:false,message:error.code==="23505"?"That store URL is already in use":"Unable to save shop settings"});
  return res.json({success:true,shop:data});
});
export default router;
