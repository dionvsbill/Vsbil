import crypto from "node:crypto";

const KEY = (() => {
  const raw = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64");
    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
})();

export function encryptSecret(value: string): string {
  if (!KEY) throw new Error("APP_ENCRYPTION_KEY is not configured");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
  if (!KEY) throw new Error("APP_ENCRYPTION_KEY is not configured");
  const [ivPart, tagPart, dataPart] = payload.split(".");
  if (!ivPart || !tagPart || !dataPart) throw new Error("Invalid encrypted secret");
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]).toString("utf8");
}

export function hmacState(value: string): string {
  const secret = process.env.APP_STATE_SECRET?.trim();
  if (!secret) throw new Error("APP_STATE_SECRET is not configured");
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

export function randomCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}
