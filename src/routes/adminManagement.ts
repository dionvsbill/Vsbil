import { Router } from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth, requireAdmin } from "../middleware/authMiddleware.js";

const router = Router();
router.use(requireAuth, requireAdmin);
const SUPER_ADMIN_EMAIL = "billphamous@gmail.com";
const protectedEmail = (email: string) => email.trim().toLowerCase() === SUPER_ADMIN_EMAIL;

router.get("/admins", async (_req, res) => {
  const { data, error } = await supabase.from("users").select("id,email,username,role,status,created_at,last_login_at,updated_at").in("role", ["admin", "support_admin"]).order("created_at", { ascending: true });
  if (error) return res.status(500).json({ success: false, message: "Unable to load administrators" });
  res.json({ success: true, admins: data ?? [] });
});

router.patch("/admins/:id", async (req, res) => {
  const id = String(req.params.id || "");
  const role = String(req.body?.role || "");
  const status = req.body?.status === undefined ? undefined : String(req.body.status);
  if (!id || !["admin", "support_admin"].includes(role) || (status !== undefined && !["active", "suspended"].includes(status))) return res.status(400).json({ success: false, message: "Invalid administrator change" });
  const { data: target } = await supabase.from("users").select("id,email,role,status").eq("id", id).maybeSingle();
  if (!target) return res.status(404).json({ success: false, message: "Administrator not found" });
  if (protectedEmail(String(target.email || ""))) return res.status(403).json({ success: false, message: "The protected super administrator cannot be demoted or suspended" });
  if (id === req.user!.id) return res.status(400).json({ success: false, message: "You cannot change your own administrator role" });
  const updates: Record<string, string> = { role };
  if (status !== undefined) updates.status = status;
  const { data, error } = await supabase.from("users").update(updates).eq("id", id).select("id,email,username,role,status,updated_at").maybeSingle();
  if (error || !data) return res.status(400).json({ success: false, message: "Unable to update administrator" });
  await supabase.from("audit_logs").insert({ admin_id: req.user!.id, action: "admin_account_update", entity_type: "user", entity_id: id, metadata: { role, status } });
  res.json({ success: true, admin: data });
});

router.delete("/admins/:id", async (req, res) => {
  const id = String(req.params.id || "");
  const { data: target } = await supabase.from("users").select("id,email,role").eq("id", id).maybeSingle();
  if (!target) return res.status(404).json({ success: false, message: "Administrator not found" });
  if (protectedEmail(String(target.email || ""))) return res.status(403).json({ success: false, message: "The protected super administrator cannot be deleted" });
  if (id === req.user!.id) return res.status(400).json({ success: false, message: "You cannot delete your own account" });
  const { error } = await supabase.from("users").update({ role: "user", status: "active", updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return res.status(400).json({ success: false, message: "Unable to remove administrator access" });
  await supabase.from("audit_logs").insert({ admin_id: req.user!.id, action: "admin_access_removed", entity_type: "user", entity_id: id, metadata: {} });
  res.json({ success: true });
});

export default router;
