import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, login, setSessionCookie, clearSessionCookie, SESSION_COOKIE } from "../auth.js";
import { AppError } from "../errors.js";
import { signSession, verifySession } from "../util/crypto.js";
import { dashboardSummary } from "../services/dashboard.js";
import {
  getBoundUser,
  getUserView,
  listConversations,
  listUsers,
  markConversationRead,
  updateRemark,
} from "../services/users.js";
import { listMessages, sendOutbound } from "../services/messages.js";
import {
  getKeepaliveConfig,
  keepalivePresets,
  keepaliveStats,
  previewKeepaliveMessage,
  runKeepalive,
  updateKeepaliveConfig,
  validateKeepaliveInput,
} from "../services/keepalive.js";
import { previewPush, pushHistory, sendPush } from "../services/push.js";
import { refreshUserInfo } from "../services/binding.js";
import { gateway } from "../ilink/gateway.js";
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  recentScheduleRuns,
  updateSchedule,
} from "../services/keepalive-schedules.js";

const idParam = z.object({ id: z.coerce.number().int().positive() });

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/login", async (request, reply) => {
    const body = z
      .object({ email: z.string().email("请输入有效邮箱"), password: z.string().min(1) })
      .parse(request.body);
    const admin = login(body.email, body.password, request.ip);
    const token = signSession({ adminId: admin.id, email: admin.email, name: admin.name });
    setSessionCookie(reply, { adminId: admin.id, email: admin.email, name: admin.name }, token);
    return { admin };
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/api/auth/me", async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    const session = token ? verifySession(token) : null;
    if (!session) return { admin: null };
    return { admin: { id: session.adminId, email: session.email, name: session.name } };
  });

  app.get("/api/dashboard", { preHandler: requireAdmin }, async () => dashboardSummary());

  app.get("/api/users", { preHandler: requireAdmin }, async (request) => {
    const query = z
      .object({
        search: z.string().optional(),
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
        sort: z.enum(["bound_desc", "bound_asc", "active_desc", "active_asc"]).optional(),
        window: z.enum(["all", "open", "closed"]).optional(),
        clawbot: z.enum(["all", "invalid"]).optional(),
      })
      .parse(request.query);
    return listUsers(query);
  });

  app.get("/api/users/:id", { preHandler: requireAdmin }, async (request) => {
    const { id } = idParam.parse(request.params);
    return { user: getUserView(id) };
  });

  app.patch("/api/users/:id", { preHandler: requireAdmin }, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ remark: z.string().min(1).max(30) }).parse(request.body);
    return { user: updateRemark(id, body.remark) };
  });

  app.post("/api/users/:id/read", { preHandler: requireAdmin }, async (request) => {
    const { id } = idParam.parse(request.params);
    return { updated: markConversationRead(id) };
  });

  app.post("/api/users/:id/typing", { preHandler: requireAdmin }, async (request) => {
    const { id } = idParam.parse(request.params);
    const user = getBoundUser(id);
    try {
      await gateway.sendTyping(user);
    } catch {
      // Typing is best-effort and never blocks the conversation.
    }
    return { ok: true };
  });

  app.post("/api/users/:id/refresh-info", { preHandler: requireAdmin }, async (request) => {
    const { id } = idParam.parse(request.params);
    const user = getUserView(id);
    const row = getBoundUser(id);
    return { user: await refreshUserInfo(row), previous: user };
  });

  app.get("/api/conversations", { preHandler: requireAdmin }, async (request) => {
    const query = z.object({ search: z.string().optional() }).parse(request.query);
    return { items: listConversations(query.search) };
  });

  app.get("/api/users/:id/messages", { preHandler: requireAdmin }, async (request) => {
    const { id } = idParam.parse(request.params);
    const query = z
      .object({
        beforeId: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(request.query);
    return listMessages(id, query.beforeId, query.limit ?? 30);
  });

  app.post("/api/users/:id/messages", { preHandler: requireAdmin }, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z
      .object({
        content: z.string().default(""),
        msgType: z.enum(["text", "image", "file"]).default("text"),
        mediaUrl: z.string().optional().nullable(),
        mediaName: z.string().max(255).optional().nullable(),
        mediaSize: z.number().int().nonnegative().optional().nullable(),
        mediaMime: z.string().max(128).optional().nullable(),
      })
      .parse(request.body);
    const message = await sendOutbound(id, {
      content: body.content,
      msgType: body.msgType,
      mediaUrl: body.mediaUrl,
      mediaName: body.mediaName,
      mediaSize: body.mediaSize,
      mediaMime: body.mediaMime,
    });
    return { message: (await import("../serializers.js")).serializeMessage(message) };
  });

  app.get("/api/keepalive", { preHandler: requireAdmin }, async () => ({
    ...keepaliveStats(),
    presets: keepalivePresets(),
  }));

  app.put("/api/keepalive/config", { preHandler: requireAdmin }, async (request) => {
    const body = z
      .object({
        enabled: z.boolean(),
        thresholdHours: z.number().int(),
        msgTemplate: z.string(),
        maxPerDay: z.number().int(),
        quotaWarnAt: z.number().int(),
        silentStart: z.string(),
        silentEnd: z.string(),
      })
      .parse(request.body);
    validateKeepaliveInput(body);
    return { config: updateKeepaliveConfig(body) };
  });

  app.get("/api/keepalive/preview", { preHandler: requireAdmin }, async (request) => {
    const query = z.object({ name: z.string().optional() }).parse(request.query);
    return { content: previewKeepaliveMessage(query.name || "林薇") };
  });

  app.post("/api/keepalive/run", { preHandler: requireAdmin }, async (request) => {
    const body = z.object({ dryRun: z.boolean().optional() }).parse(request.body ?? {});
    return runKeepalive({ dryRun: body.dryRun });
  });

  app.post("/api/push/preview", { preHandler: requireAdmin }, async (request) => {
    const body = z.object({ userIds: z.array(z.number().int().positive()).max(500) }).parse(request.body);
    return previewPush(body.userIds);
  });

  app.post("/api/push", { preHandler: requireAdmin }, async (request) => {
    const body = z
      .object({
        userIds: z.array(z.number().int().positive()).min(1).max(500),
        content: z.string(),
        msgType: z.enum(["text", "image", "file"]).default("text"),
        mediaUrl: z.string().nullable().optional(),
        mediaName: z.string().max(255).optional().nullable(),
        mediaSize: z.number().int().nonnegative().optional().nullable(),
        mediaMime: z.string().max(128).optional().nullable(),
      })
      .parse(request.body);
    return sendPush(body);
  });

  app.get("/api/push/history", { preHandler: requireAdmin }, async () => ({
    items: pushHistory(),
  }));

  app.get("/api/keepalive/config", { preHandler: requireAdmin }, async () => ({
    config: getKeepaliveConfig(),
  }));

  app.get("/api/keepalive/schedules", { preHandler: requireAdmin }, async () => ({
    items: listSchedules(),
    runs: recentScheduleRuns(),
  }));

  app.post("/api/keepalive/schedules", { preHandler: requireAdmin }, async (request) => {
    const body = z
      .object({
        cronExpr: z.string().min(1),
        message: z.string(),
        mediaType: z.enum(["text", "image", "file"]).optional(),
        mediaUrl: z.string().nullable().optional(),
        mediaName: z.string().max(255).nullable().optional(),
        enabled: z.boolean().optional(),
        onlyIfActive: z.boolean().optional(),
      })
      .parse(request.body);
    return { item: createSchedule(body) };
  });

  app.patch("/api/keepalive/schedules/:id", { preHandler: requireAdmin }, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z
      .object({
        cronExpr: z.string().min(1).optional(),
        message: z.string().optional(),
        mediaType: z.enum(["text", "image", "file"]).optional(),
        mediaUrl: z.string().nullable().optional(),
        mediaName: z.string().max(255).nullable().optional(),
        enabled: z.boolean().optional(),
        onlyIfActive: z.boolean().optional(),
      })
      .parse(request.body);
    return { item: updateSchedule(id, body) };
  });

  app.delete("/api/keepalive/schedules/:id", { preHandler: requireAdmin }, async (request) => {
    const { id } = idParam.parse(request.params);
    deleteSchedule(id);
    return { ok: true };
  });
}
