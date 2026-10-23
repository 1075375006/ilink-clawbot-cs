import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../auth.js";
import { getDb } from "../db.js";
import { AppError } from "../errors.js";
import {
  channelStatus,
  disconnect,
  pollLogin,
  setCustomerQr,
  startLogin,
  switchMode,
} from "../services/channel.js";
import { handleInbound } from "../services/messages.js";
import { getBoundUser } from "../services/users.js";
import { uploadAttachment } from "../services/uploads.js";

export async function registerChannelRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/channel", { preHandler: requireAdmin }, async () => channelStatus());

  app.post("/api/channel/mode", { preHandler: requireAdmin }, async (request) => {
    const body = z.object({ mode: z.enum(["demo", "live"]) }).parse(request.body);
    return switchMode(body.mode);
  });

  app.post("/api/channel/login/start", { preHandler: requireAdmin }, async () => startLogin());

  app.get("/api/channel/login/:id/status", { preHandler: requireAdmin }, async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    return pollLogin(id);
  });

  app.post("/api/channel/disconnect", { preHandler: requireAdmin }, async () => disconnect());

  app.put("/api/channel/customer-qr", { preHandler: requireAdmin }, async (request) => {
    const body = z.object({ url: z.string().max(1024).nullable() }).parse(request.body);
    return setCustomerQr(body.url);
  });

  app.post("/api/channel/demo/inbound", { preHandler: requireAdmin }, async (request) => {
    const body = z
      .object({
        userId: z.number().int().positive(),
        content: z.string().min(1).max(1000),
      })
      .parse(request.body);
    const user = getBoundUser(body.userId);
    const channel = getDb().prepare("SELECT mode FROM channel_config WHERE id = 1").get() as {
      mode: string;
    };
    if (channel.mode !== "demo") {
      throw new AppError(409, "DEMO_ONLY", "真实通道下不能模拟客户消息。");
    }
    await handleInbound({
      openid: user.clawbot_openid,
      text: body.content,
      images: [],
      files: [],
      contextToken: `ctx_demo_${crypto.randomBytes(6).toString("hex")}`,
      ilinkMsgId: `demo_manual_${crypto.randomUUID()}`,
      messageId: null,
      clientId: null,
      at: new Date().toISOString(),
    });
    return { ok: true };
  });

  app.post("/api/uploads", { preHandler: requireAdmin }, uploadAttachment);
}
