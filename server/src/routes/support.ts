import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../auth.js";
import {
  SUPPORT_COOKIE,
  clearSupportCookie,
  loginSupport,
  requireSupport,
  resolveSupportSession,
  setSupportCookie,
} from "../support-auth.js";
import { signSupportSession } from "../util/crypto.js";
import {
  createAgent,
  listAgents,
  resetAgentPassword,
  updateAgent,
} from "../services/support-agents.js";
import {
  getBoundUser,
  getUserView,
  listConversations,
  markConversationRead,
  updateRemark,
} from "../services/users.js";
import { listMessages, sendOutbound } from "../services/messages.js";
import { serializeMessage } from "../serializers.js";
import { uploadAttachment } from "../services/uploads.js";
import { gateway } from "../ilink/gateway.js";

const idParam = z.object({ id: z.coerce.number().int().positive() });
const name = z.string().trim().min(1, "请输入客服姓名").max(30);
const password = z
  .string()
  .min(8, "密码至少 8 位")
  .max(128, "密码不能超过 128 位");

export async function registerSupportRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/support-agents", { preHandler: requireAdmin }, async () => ({
    items: listAgents(),
  }));
  app.post(
    "/api/support-agents",
    { preHandler: requireAdmin },
    async (request) => {
      const body = z
        .object({
          username: z
            .string()
            .trim()
            .toLowerCase()
            .min(3)
            .max(40)
            .regex(
              /^[a-z0-9][a-z0-9_.-]+$/,
              "账号仅支持英文字母、数字、下划线、点和短横线",
            ),
          name,
          password,
        })
        .parse(request.body);
      return { agent: createAgent(body) };
    },
  );
  app.patch(
    "/api/support-agents/:id",
    { preHandler: requireAdmin },
    async (request) => {
      const { id } = idParam.parse(request.params);
      const body = z
        .object({ name: name.optional(), enabled: z.boolean().optional() })
        .parse(request.body);
      return { agent: updateAgent(id, body) };
    },
  );
  app.post(
    "/api/support-agents/:id/password",
    { preHandler: requireAdmin },
    async (request) => {
      const { id } = idParam.parse(request.params);
      const body = z.object({ password }).parse(request.body);
      resetAgentPassword(id, body.password);
      return { ok: true };
    },
  );

  app.post("/api/support/auth/login", async (request, reply) => {
    const body = z
      .object({
        username: z.string().trim().min(1).max(40),
        password: z.string().min(1).max(128),
      })
      .parse(request.body);
    const { agent, version } = loginSupport(
      body.username,
      body.password,
      request.ip,
    );
    setSupportCookie(
      reply,
      signSupportSession({ role: "support", agentId: agent.id, version }),
    );
    return { agent };
  });
  app.get("/api/support/auth/me", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const agent = resolveSupportSession(request.cookies[SUPPORT_COOKIE]);
    if (!agent) clearSupportCookie(reply);
    return { agent };
  });
  app.post("/api/support/auth/logout", async (_request, reply) => {
    clearSupportCookie(reply);
    return { ok: true };
  });

  app.get(
    "/api/support/conversations",
    { preHandler: requireSupport },
    async (request) => {
      const query = z
        .object({ search: z.string().max(100).optional() })
        .parse(request.query);
      return { items: listConversations(query.search) };
    },
  );
  app.get(
    "/api/support/users/:id",
    { preHandler: requireSupport },
    async (request) => {
      const { id } = idParam.parse(request.params);
      getBoundUser(id);
      return { user: getUserView(id) };
    },
  );
  app.patch(
    "/api/support/users/:id",
    { preHandler: requireSupport },
    async (request) => {
      const { id } = idParam.parse(request.params);
      const body = z
        .object({ remark: z.string().trim().min(1).max(30) })
        .parse(request.body);
      return { user: updateRemark(id, body.remark) };
    },
  );
  app.get(
    "/api/support/users/:id/messages",
    { preHandler: requireSupport },
    async (request) => {
      const { id } = idParam.parse(request.params);
      getBoundUser(id);
      const query = z
        .object({
          beforeId: z.coerce.number().int().positive().optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
        })
        .parse(request.query);
      return listMessages(id, query.beforeId, query.limit ?? 40);
    },
  );
  app.post(
    "/api/support/users/:id/messages",
    { preHandler: requireSupport },
    async (request) => {
      const { id } = idParam.parse(request.params);
      const body = z
        .object({
          content: z.string().max(100_000).default(""),
          msgType: z.enum(["text", "image", "file"]).default("text"),
          mediaUrl: z.string().nullable().optional(),
          mediaName: z.string().max(255).nullable().optional(),
          mediaSize: z.number().int().nonnegative().nullable().optional(),
          mediaMime: z.string().max(128).nullable().optional(),
        })
        .parse(request.body);
      return { message: serializeMessage(await sendOutbound(id, body)) };
    },
  );
  app.post(
    "/api/support/users/:id/read",
    { preHandler: requireSupport },
    async (request) => {
      const { id } = idParam.parse(request.params);
      getBoundUser(id);
      return { updated: markConversationRead(id) };
    },
  );
  app.post(
    "/api/support/users/:id/typing",
    { preHandler: requireSupport },
    async (request) => {
      const { id } = idParam.parse(request.params);
      const user = getBoundUser(id);
      await gateway.sendTyping(user).catch(() => undefined);
      return { ok: true };
    },
  );
  app.post(
    "/api/support/uploads",
    { preHandler: requireSupport },
    uploadAttachment,
  );
}
