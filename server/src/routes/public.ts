import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db.js";
import { env, isBeichenConfigured } from "../env.js";
import { AppError } from "../errors.js";
import { requireAdmin } from "../auth.js";
import {
  completeOAuth,
  createSession,
  getSessionView,
  qrForSession,
  refreshClawbotQr,
  resolveOAuthRedirect,
  simulateScan,
} from "../services/binding.js";
import { channelStatus } from "../services/channel.js";

const tokenParam = z.object({ token: z.string().min(8).max(128) });
const bindAttempts = new Map<string, { count: number; resetAt: number }>();

export async function registerPublicRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/public/bind/sessions", async (request) => {
    const now = Date.now();
    const record = bindAttempts.get(request.ip);
    if (record && record.resetAt > now && record.count >= 10) {
      throw new AppError(429, "ERR_QR_RATE_LIMIT", "二维码生成过于频繁，请稍后再试。");
    }
    bindAttempts.set(request.ip, {
      count: record && record.resetAt > now ? record.count + 1 : 1,
      resetAt: record && record.resetAt > now ? record.resetAt : now + 60_000,
    });
    const session = await createSession();
    return {
      ...session,
      qrUrl: `/api/public/bind/${session.token}/qr.png`,
      statusUrl: `/api/public/bind/${session.token}`,
    };
  });

  app.get("/api/health", async () => {
    const db = getDb();
    db.prepare("SELECT 1").get();
    const schema = db
      .prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")
      .get() as { version: string } | undefined;
    return {
      status: "ok",
      uptime: Math.floor(process.uptime()),
      db: "connected",
      schema: schema?.version ?? null,
      time: new Date().toISOString(),
    };
  });

  app.post("/api/bind/sessions", { preHandler: requireAdmin }, async () => {
    const session = await createSession();
    return {
      ...session,
      qrUrl: `/api/public/bind/${session.token}/qr.png`,
      statusUrl: `/api/public/bind/${session.token}`,
    };
  });

  app.get("/api/bind/sessions/recent", { preHandler: requireAdmin }, async () => {
    const rows = getDb()
      .prepare(
        `SELECT b.*, u.nickname, u.remark, u.faceimg
         FROM binding_sessions b LEFT JOIN users u ON u.id = b.user_id
         WHERE b.status IN ('completed', 'awaiting_oauth', 'scanned')
         ORDER BY b.created_at DESC LIMIT 10`,
      )
      .all() as Array<{
      token: string;
      status: string;
      created_at: string;
      completed_at: string | null;
      nickname: string | null;
      remark: string | null;
      faceimg: string | null;
    }>;
    return {
      items: rows.map((row) => ({
        token: row.token,
        status: row.status,
        createdAt: row.created_at,
        completedAt: row.completed_at,
        name: row.remark || row.nickname || null,
        avatar: row.faceimg,
      })),
    };
  });

  app.get("/api/public/bind/:token", async (request) => {
    const { token } = tokenParam.parse(request.params);
    return getSessionView(token);
  });

  app.get("/api/public/bind/:token/qr.png", async (request, reply) => {
    const { token } = tokenParam.parse(request.params);
    const buffer = await qrForSession(token);
    reply.header("Content-Type", "image/png");
    reply.header("Cache-Control", "no-store");
    return reply.send(buffer);
  });

  app.post("/api/public/bind/:token/simulate-scan", async (request) => {
    const { token } = tokenParam.parse(request.params);
    return simulateScan(token);
  });

  app.post("/api/public/bind/:token/refresh-qr", async (request) => {
    const { token } = tokenParam.parse(request.params);
    return refreshClawbotQr(token);
  });

  app.get("/api/oauth/beichen/entry", async (request, reply) => {
    const query = z.object({ state: z.string().min(8) }).parse(request.query);
    const target = await resolveOAuthRedirect(query.state);
    return reply.redirect(target);
  });

  app.get("/api/oauth/beichen/callback", async (request, reply) => {
    const query = z
      .object({
        state: z.string().min(8),
        code: z.string().min(1),
        type: z.string().optional(),
        format: z.string().optional(),
      })
      .parse(request.query);
    const result = await completeOAuth({
      state: query.state,
      code: query.code,
      loginType: query.type,
    });
    if (query.format === "json") {
      return { ok: true, token: result.token, userId: result.userId };
    }
    const base = (env.webOrigin || env.publicBaseUrl).replace(/\/+$/, "");
    return reply.redirect(`${base}/bind?token=${encodeURIComponent(result.token)}`);
  });

  app.get("/api/avatar/:name", async (request, reply) => {
    const params = z.object({ name: z.string().min(1).max(64) }).parse(request.params);
    const name = params.name.replace(/\.svg$/i, "");
    const palettes = [
      ["#6C8CFF", "#3E5EDB"],
      ["#56CCF2", "#2D9CDB"],
      ["#F2994A", "#D96C2C"],
      ["#BB6BD9", "#8E44AD"],
      ["#27AE60", "#1E8449"],
      ["#EB5757", "#C0392B"],
      ["#00B8A9", "#00897B"],
      ["#F2C94C", "#D4A017"],
    ];
    const hash = crypto.createHash("sha256").update(name).digest();
    const palette = palettes[hash.readUInt8(0) % palettes.length]!;
    const initial = [...name][0] ?? "客";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${palette[0]}"/><stop offset="100%" stop-color="${palette[1]}"/>
      </linearGradient></defs>
      <rect width="120" height="120" rx="60" fill="url(#g)"/>
      <text x="60" y="76" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif"
        font-size="48" font-weight="600" fill="#fff" opacity=".95">${initial}</text>
    </svg>`;
    reply.header("Content-Type", "image/svg+xml");
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.send(svg);
  });

  app.get("/api/system/info", async () => ({
    demoMode: !isBeichenConfigured,
    channel: channelStatus(),
  }));
}
