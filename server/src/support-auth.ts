import type { FastifyReply, FastifyRequest } from "fastify";
import { getDb } from "./db.js";
import { env } from "./env.js";
import { AppError } from "./errors.js";
import { verifyPassword, verifySupportSession } from "./util/crypto.js";
import {
  serializeAgent,
  type SupportAgentRow,
} from "./services/support-agents.js";

export const SUPPORT_COOKIE = "ilink_support_session";
const attempts = new Map<string, { count: number; resetAt: number }>();

export function resolveSupportSession(token?: string) {
  const session = token ? verifySupportSession(token) : null;
  if (!session) return null;
  const row = getDb()
    .prepare("SELECT * FROM support_agents WHERE id = ?")
    .get(session.agentId) as SupportAgentRow | undefined;
  if (!row || !row.enabled || row.session_version !== session.version)
    return null;
  return serializeAgent(row);
}

export async function requireSupport(request: FastifyRequest): Promise<void> {
  const agent = resolveSupportSession(request.cookies[SUPPORT_COOKIE]);
  if (!agent)
    throw new AppError(
      401,
      "SUPPORT_UNAUTHORIZED",
      "客服登录已失效，请重新登录。",
    );
  request.supportAgent = agent;
}

export function loginSupport(
  usernameRaw: string,
  password: string,
  ip: string,
) {
  const username = usernameRaw.trim().toLowerCase();
  const key = `${ip}:${username}`;
  const now = Date.now();
  const record = attempts.get(key);
  if (record && record.resetAt > now && record.count >= 5) {
    throw new AppError(
      429,
      "LOGIN_LOCKED",
      "密码错误次数过多，请 30 分钟后再试。",
    );
  }
  const row = getDb()
    .prepare("SELECT * FROM support_agents WHERE username = ?")
    .get(username) as SupportAgentRow | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) {
    const next =
      record && record.resetAt > now
        ? record
        : { count: 0, resetAt: now + 30 * 60 * 1000 };
    next.count += 1;
    attempts.set(key, next);
    throw new AppError(401, "INVALID_CREDENTIALS", "客服账号或密码不正确。");
  }
  if (!row.enabled)
    throw new AppError(
      403,
      "AGENT_DISABLED",
      "此客服账号已停用，请联系管理员。",
    );
  attempts.delete(key);
  const at = new Date().toISOString();
  getDb()
    .prepare("UPDATE support_agents SET last_login_at = ? WHERE id = ?")
    .run(at, row.id);
  return {
    agent: serializeAgent({ ...row, last_login_at: at }),
    version: row.session_version,
  };
}

export function setSupportCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SUPPORT_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    maxAge: 12 * 60 * 60,
  });
}

export function clearSupportCookie(reply: FastifyReply) {
  reply.clearCookie(SUPPORT_COOKIE, { path: "/" });
}
