import type { FastifyReply, FastifyRequest } from "fastify";
import { getDb } from "./db.js";
import { AppError } from "./errors.js";
import { verifyPassword } from "./util/crypto.js";
import { env } from "./env.js";
import { verifySession, type SessionPayload } from "./util/crypto.js";

export const SESSION_COOKIE = "ilink_session";

const attempts = new Map<string, { count: number; resetAt: number }>();

export async function requireAdmin(request: FastifyRequest): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];
  const session = token ? verifySession(token) : null;
  if (!session) {
    throw new AppError(401, "UNAUTHORIZED", "登录已过期，请重新登录。");
  }
  request.admin = session;
}

export function login(emailRaw: string, password: string, ip: string) {
  const email = emailRaw.trim().toLowerCase();
  const key = `${ip}:${email}`;
  const now = Date.now();
  const record = attempts.get(key);
  if (record && record.resetAt > now && record.count >= 5) {
    throw new AppError(429, "LOGIN_LOCKED", "密码错误次数过多，请 30 分钟后再试。");
  }
  const admin = getDb()
    .prepare("SELECT id, email, password_hash, name FROM admins WHERE email = ?")
    .get(email) as
    | { id: number; email: string; password_hash: string; name: string }
    | undefined;
  if (!admin || !verifyPassword(password, admin.password_hash)) {
    const next = record && record.resetAt > now ? record : { count: 0, resetAt: now + 30 * 60 * 1000 };
    next.count += 1;
    attempts.set(key, next);
    throw new AppError(401, "INVALID_CREDENTIALS", "邮箱或密码不正确。");
  }
  attempts.delete(key);
  return { id: admin.id, email: admin.email, name: admin.name };
}

export function setSessionCookie(
  reply: FastifyReply,
  payload: SessionPayload,
  token: string,
): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    maxAge: 7 * 24 * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}
