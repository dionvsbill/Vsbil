import type { Request, Response, NextFunction } from "express";
import { supabase } from "../config/supabase.js";

const FALLBACK_DISABLED = new Set(["landlord", "services"]);
const cache = new Map<string, { enabled: boolean; expiresAt: number }>();
const CACHE_MS = 5000;

async function getFeatureState(key: string): Promise<boolean> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.enabled;

  const { data, error } = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("key", key)
    .maybeSingle();

  if (error) {
    return !FALLBACK_DISABLED.has(key);
  }

  const enabled = data?.enabled === true;
  cache.set(key, { enabled, expiresAt: Date.now() + CACHE_MS });
  return enabled;
}

export const featureEnabled = async (key: string): Promise<boolean> => getFeatureState(key);

export const featureGate = (key: string) => async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (await getFeatureState(key)) return next();
    return res.status(403).json({
      success: false,
      code: "FEATURE_DISABLED",
      message: "This feature is currently unavailable.",
      feature: key,
    });
  } catch {
    return res.status(503).json({
      success: false,
      code: "FEATURE_CONTROL_UNAVAILABLE",
      message: "Feature availability could not be confirmed.",
    });
  }
};

export const clearFeatureCache = (key?: string) => {
  if (key) cache.delete(key);
  else cache.clear();
};
