import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middleware/authMiddleware.js";
const router = Router();
const ACTIVATION_AMOUNT_GHS = 50;
const ACTIVATION_AMOUNT_PESEWAS = 5000;

router.post("/initialize", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { data: user } = await supabase.from("users").select("id,email,username,status").eq("id", userId).maybeSingle();
    if (!user) return res.status(404).json({ success:false,message:"Account not found" });
    if (user.status === "active") return res.status(409).json({ success:false,message:"Account is already active" });
    const { data: existing } = await supabase.from("payments").select("id,reference,status").eq("user_id",userId).eq("purpose","activation").eq("status","pending").order("created_at",{ascending:false}).limit(1).maybeSingle();
    if (existing) return await createPaystackCheckout(existing.reference,user.email,userId,res);
    const reference = `VSBIL-ACT-${Date.now()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
    const { error } = await supabase.from("payments").insert({ user_id:userId,reference,amount:ACTIVATION_AMOUNT_PESEWAS,amount_ghs:ACTIVATION_AMOUNT_GHS,currency:"GHS",provider:"paystack",purpose:"activation",status:"pending" });
    if (error) return res.status(500).json({ success:false,message:"Unable to create payment" });
    return await createPaystackCheckout(reference,user.email,userId,res);
  } catch(e) { console.error(e); return res.status(500).json({success:false,message:"Unable to initialize payment"}); }
});

async function createPaystackCheckout(reference:string,email:string,userId:string,res:Response) {
  const secret=process.env.PAYSTACK_SECRET_KEY;
  const callbackUrl=process.env.PAYSTACK_CALLBACK_URL || `${process.env.APP_URL || ""}/activation.html`;
  if(!secret || !process.env.APP_URL) return res.status(503).json({success:false,message:"Payment service is not configured. Set PAYSTACK_SECRET_KEY and APP_URL."});
  const response=await fetch("https://api.paystack.co/transaction/initialize",{method:"POST",headers:{Authorization:`Bearer ${secret}`,"Content-Type":"application/json"},body:JSON.stringify({email,amount:ACTIVATION_AMOUNT_PESEWAS,currency:"GHS",reference,callback_url:callbackUrl,metadata:{user_id:userId,purpose:"activation",version:"v2"}})});
  const data:any=await response.json().catch(()=>null);
  if(!response.ok || !data?.status) { console.error("Paystack initialize",data); return res.status(502).json({success:false,message:"Unable to initialize payment"}); }
  await supabase.from("payments").update({provider_reference:reference,updated_at:new Date().toISOString()}).eq("reference",reference);
  return res.json({success:true,authorization_url:data.data.authorization_url,reference});
}

router.get("/verify", async (req:Request,res:Response)=>{
  try{
    const reference=typeof req.query.reference==="string"?req.query.reference.trim():"";
    if(!reference) return res.status(400).json({success:false,message:"Payment reference is required"});
    const secret=process.env.PAYSTACK_SECRET_KEY; if(!secret) return res.status(503).json({success:false,message:"Payment service is not configured"});
    const response=await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,{headers:{Authorization:`Bearer ${secret}`} });
    const pay:any=await response.json().catch(()=>null);
    if(!response.ok || !pay?.status || !pay.data) return res.status(502).json({success:false,message:"Unable to verify payment"});
    const tx=pay.data;
    const {data:payment}=await supabase.from("payments").select("*").eq("reference",reference).eq("purpose","activation").maybeSingle();
    if(!payment) return res.status(404).json({success:false,message:"Payment record not found"});
    if(tx.status!=="success") return res.status(400).json({success:false,message:"Payment has not been completed",status:tx.status});
    if(Number(tx.amount)!==ACTIVATION_AMOUNT_PESEWAS || String(tx.currency).toUpperCase()!=="GHS") return res.status(400).json({success:false,message:"Payment amount or currency mismatch"});
    if(tx.metadata?.user_id!==payment.user_id || tx.reference!==payment.reference) return res.status(400).json({success:false,message:"Payment account mismatch"});
    const {data:result,error}=await supabase.rpc("activate_user_after_payment",{p_payment_id:payment.id,p_provider_reference:String(tx.id)});
    if(error){ console.error("Activation RPC",error); return res.status(500).json({success:false,message:"Payment verified but activation could not be finalized"}); }
    return res.json({success:true,message:"Payment verified. Account activated.",result});
  }catch(e){console.error(e);return res.status(500).json({success:false,message:"Unable to verify payment"});}
});

router.post("/webhook", async(req,res)=>{
  const signature=String(req.headers["x-paystack-signature"]||""); const secret=process.env.PAYSTACK_SECRET_KEY;
  if(!secret || !signature) return res.status(401).send("Unauthorized");
  const raw=JSON.stringify(req.body); const expected=crypto.createHmac("sha512",secret).update(raw).digest("hex");
  if(!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected))) return res.status(401).send("Invalid signature");
  try{
    const event=req.body;
    if(event?.event==="charge.success" && event.data?.reference){
      const reference=String(event.data.reference); const {data:payment}=await supabase.from("payments").select("id,user_id,reference").eq("reference",reference).eq("purpose","activation").maybeSingle();
      if(payment) await supabase.rpc("activate_user_after_payment",{p_payment_id:payment.id,p_provider_reference:String(event.data.id)});
    }
    return res.sendStatus(200);
  }catch(e){console.error("Webhook",e);return res.sendStatus(500);}
});
export default router;
