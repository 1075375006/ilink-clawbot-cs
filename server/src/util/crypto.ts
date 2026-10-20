import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../env.js";

function credentialKey(): Buffer {
  const raw = env.credentialKey.trim();
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", credentialKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    const [version, ivRaw, tagRaw, dataRaw] = payload.split(".");
    if (version !== "v1" || !ivRaw || !tagRaw || !dataRaw) return null;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      credentialKey(),
      Buffer.from(ivRaw, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltRaw, hashRaw] = stored.split("$");
  if (scheme !== "scrypt" || !saltRaw || !hashRaw) return false;
  const salt = Buffer.from(saltRaw, "base64url");
  const expected = Buffer.from(hashRaw, "base64url");
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function randomCode(bytes = 4): string {
  return crypto.randomBytes(bytes).toString("hex").toUpperCase();
}

export interface SessionPayload {
  adminId: number;
  email: string;
  name: string;
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, env.sessionSecret, { expiresIn: "7d" });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, env.sessionSecret) as SessionPayload;
  } catch {
    return null;
  }
}
