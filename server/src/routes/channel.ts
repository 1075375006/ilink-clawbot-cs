import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../auth.js";
import { env } from "../env.js";
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

const ALLOWED_IMAGES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const FILE_MAX_BYTES = 20 * 1024 * 1024;

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

  app.post("/api/uploads", { preHandler: requireAdmin }, async (request) => {
    const file = await request.file();
    if (!file) throw new AppError(400, "NO_FILE", "请选择要上传的文件。");
    const isImage = ALLOWED_IMAGES.has(file.mimetype);
    const buffer = await file.toBuffer();
    if (file.mimetype.startsWith("image/") && !isImage) {
      throw new AppError(415, "UNSUPPORTED_MEDIA", "仅支持 PNG、JPG、WEBP、GIF 图片。");
    }
    const limit = isImage ? IMAGE_MAX_BYTES : FILE_MAX_BYTES;
    if (buffer.length > limit) {
      throw new AppError(
        413,
        "FILE_TOO_LARGE",
        isImage ? "图片不能超过 8MB。" : "文件不能超过 20MB。",
      );
    }
    const originalName = path.basename(file.filename || "file");
    const ext = isImage
      ? file.mimetype === "image/png"
        ? "png"
        : file.mimetype === "image/jpeg"
          ? "jpg"
          : file.mimetype === "image/webp"
            ? "webp"
            : "gif"
      : path.extname(originalName).slice(0, 16).replace(/[^.\w-]/g, "") || ".bin";
    const now = new Date();
    const folder = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const dir = path.join(env.uploadDir, folder);
    fs.mkdirSync(dir, { recursive: true });
    const stored = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${
      ext.startsWith(".") ? ext : `.${ext}`
    }`;
    fs.writeFileSync(path.join(dir, stored), buffer);
    return {
      url: `/uploads/${folder}/${stored}`,
      name: originalName,
      size: buffer.length,
      mimeType: file.mimetype,
      isImage,
    };
  });
}
