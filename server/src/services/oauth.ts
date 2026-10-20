import { env, isOAuthConfigured } from "../env.js";
import { AppError } from "../errors.js";

export interface OAuthIdentity {
  social_uid: string;
  nickname: string;
  faceimg: string;
  login_type: string;
  gender?: string;
  location?: string;
}

type JsonRecord = Record<string, unknown>;

function providerLabel(): string {
  const provider = env.oauth.provider;
  if (provider === "suyanw") return "素颜";
  if (provider === "beichenwl") return "北辰";
  return provider || "聚合登录";
}

function unwrap(payload: JsonRecord): JsonRecord {
  if (payload.data && typeof payload.data === "object") return payload.data as JsonRecord;
  return payload;
}

function pickString(record: JsonRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

async function getJson(url: string): Promise<JsonRecord> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new AppError(
      502,
      "ERR_OAUTH_UNAVAILABLE",
      `${providerLabel()} 登录服务暂时不可达，请稍后重试。`,
    );
  }
  if (!response.ok) {
    throw new AppError(502, "ERR_OAUTH_HTTP", `${providerLabel()} 登录服务返回 ${response.status}。`);
  }
  try {
    return (await response.json()) as JsonRecord;
  } catch {
    throw new AppError(502, "ERR_OAUTH_FORMAT", `${providerLabel()} 登录服务返回了无法解析的数据。`);
  }
}

function assertOk(payload: JsonRecord): JsonRecord {
  const data = unwrap(payload);
  const code = Number(data.code ?? payload.code ?? 0);
  if (Number.isFinite(code) && code !== 0) {
    const message =
      pickString(data, "msg", "message", "error") ||
      pickString(payload, "msg", "message", "error") ||
      "授权失败，请重新发起登录。";
    throw new AppError(400, "ERR_OAUTH_AUTH", message);
  }
  return data;
}

export function oauthConfigured(): boolean {
  return isOAuthConfigured;
}

export async function getLoginUrl(
  redirectUri: string,
  loginType = env.oauth.loginType,
): Promise<string> {
  if (!isOAuthConfigured) {
    throw new AppError(
      503,
      "ERR_OAUTH_NOT_CONFIGURED",
      `${providerLabel()} 聚合登录尚未配置。`,
    );
  }
  const url = new URL(`${env.oauth.apiBase}/connect.php`);
  url.searchParams.set("act", "login");
  url.searchParams.set("appid", env.oauth.appid);
  url.searchParams.set("appkey", env.oauth.appkey);
  url.searchParams.set("type", loginType);
  url.searchParams.set("redirect_uri", redirectUri);
  const data = assertOk(await getJson(url.toString()));
  const target = pickString(data, "url", "login_url", "redirect");
  if (!target) {
    throw new AppError(502, "ERR_OAUTH_URL", `${providerLabel()} 未返回授权跳转地址。`);
  }
  return target;
}

export async function exchangeCode(
  code: string,
  loginType: string,
): Promise<OAuthIdentity> {
  if (!isOAuthConfigured) {
    throw new AppError(
      503,
      "ERR_OAUTH_NOT_CONFIGURED",
      `${providerLabel()} 聚合登录尚未配置。`,
    );
  }
  const url = new URL(`${env.oauth.apiBase}/connect.php`);
  url.searchParams.set("act", "callback");
  url.searchParams.set("appid", env.oauth.appid);
  url.searchParams.set("appkey", env.oauth.appkey);
  url.searchParams.set("type", loginType);
  url.searchParams.set("code", code);
  const data = assertOk(await getJson(url.toString()));
  return toIdentity(data, loginType);
}

export async function queryUser(
  socialUid: string,
  loginType: string,
): Promise<OAuthIdentity> {
  if (!isOAuthConfigured) {
    throw new AppError(
      503,
      "ERR_OAUTH_NOT_CONFIGURED",
      `${providerLabel()} 聚合登录尚未配置。`,
    );
  }
  const url = new URL(`${env.oauth.apiBase}/connect.php`);
  url.searchParams.set("act", "query");
  url.searchParams.set("appid", env.oauth.appid);
  url.searchParams.set("appkey", env.oauth.appkey);
  url.searchParams.set("type", loginType);
  url.searchParams.set("social_uid", socialUid);
  const data = assertOk(await getJson(url.toString()));
  return toIdentity(data, loginType);
}

function toIdentity(data: JsonRecord, fallbackType: string): OAuthIdentity {
  const socialUid = pickString(data, "social_uid", "socialUid", "openid", "uid");
  if (!socialUid) {
    throw new AppError(
      502,
      "ERR_OAUTH_IDENTITY",
      `${providerLabel()} 未返回用户唯一标识 social_uid。`,
    );
  }
  return {
    social_uid: socialUid,
    nickname: pickString(data, "nickname", "nick_name", "name"),
    faceimg: pickString(data, "faceimg", "face_img", "headimgurl", "avatar", "avatar_url"),
    login_type: pickString(data, "login_type", "type") || fallbackType,
    gender: pickString(data, "gender", "sex") || undefined,
    location: pickString(data, "location", "city") || undefined,
  };
}
