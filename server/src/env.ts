import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(serverDir, "../..");

dotenv.config({ path: path.join(ROOT_DIR, ".env") });
dotenv.config({ path: path.join(serverDir, "../.env"), override: false });

function resolveFromRoot(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(ROOT_DIR, value);
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const publicBaseUrl = (process.env.PUBLIC_BASE_URL || "http://localhost:3001").replace(/\/+$/, "");

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  isProd: process.env.NODE_ENV === "production",
  port: int(process.env.PORT, 3001),
  publicBaseUrl,
  webOrigin: process.env.WEB_ORIGIN || "",
  databasePath: resolveFromRoot(process.env.DATABASE_PATH || "./data/ilink.db"),
  uploadDir: resolveFromRoot(process.env.UPLOAD_DIR || "./uploads"),
  redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  sessionSecret:
    process.env.SESSION_SECRET ||
    "dev-only-insecure-session-secret-change-me-please-1234567890",
  credentialKey:
    process.env.ILINK_CREDENTIAL_KEY ||
    "0000000000000000000000000000000000000000000000000000000000000000",
  admin: {
    email: (process.env.ADMIN_EMAIL || "admin@ilink.local").toLowerCase(),
    password: process.env.ADMIN_PASSWORD || "admin123456",
    name: process.env.ADMIN_NAME || "客服管理员",
  },
  ilink: {
    mode: (process.env.ILINK_MODE || "demo").toLowerCase() === "live" ? "live" : "demo",
    baseUrl: process.env.ILINK_BASE_URL || "https://ilinkai.weixin.qq.com",
    channelVersion: process.env.ILINK_CHANNEL_VERSION || "standalone-0.1.0",
  },
  oauth: {
    appid: process.env.OAUTH_APPID || process.env.BEICHEN_APPID || "",
    appkey: process.env.OAUTH_APPKEY || process.env.BEICHEN_APPKEY || "",
    loginType: process.env.OAUTH_LOGIN_TYPE || process.env.BEICHEN_LOGIN_TYPE || "wx",
    apiBase: (
      process.env.OAUTH_API_BASE ||
      process.env.BEICHEN_API_BASE ||
      "https://u.suyanw.cn"
    ).replace(/\/+$/, ""),
    provider: (process.env.OAUTH_PROVIDER || "suyanw").toLowerCase(),
  },
  keepaliveCron: process.env.KEEPALIVE_CRON || "*/5 * * * *",
  messageRetentionDays: int(process.env.MESSAGE_RETENTION_DAYS, 30),
  messageMaxCount: int(process.env.MESSAGE_MAX_COUNT, 100000),
  seedDemo: bool(process.env.SEED_DEMO, true),
} as const;

export const isOAuthConfigured = Boolean(env.oauth.appid && env.oauth.appkey);
export const isBeichenConfigured = isOAuthConfigured;

export function oauthRedirectUri(): string {
  return `${env.publicBaseUrl}/api/oauth/callback`;
}

export function beichenRedirectUri(): string {
  return oauthRedirectUri();
}
