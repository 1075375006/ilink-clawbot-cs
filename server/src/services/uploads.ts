import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyRequest } from "fastify";
import { env } from "../env.js";
import { AppError } from "../errors.js";

const ALLOWED_IMAGES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export async function uploadAttachment(request: FastifyRequest) {
  const file = await request.file();
  if (!file) throw new AppError(400, "NO_FILE", "请选择要上传的文件。");
  const isImage = ALLOWED_IMAGES.has(file.mimetype);
  const buffer = await file.toBuffer();
  if (file.mimetype.startsWith("image/") && !isImage) {
    throw new AppError(
      415,
      "UNSUPPORTED_MEDIA",
      "仅支持 PNG、JPG、WEBP、GIF 图片。",
    );
  }
  if (buffer.length > (isImage ? 8 : 20) * 1024 * 1024) {
    throw new AppError(
      413,
      "FILE_TOO_LARGE",
      isImage ? "图片不能超过 8MB。" : "文件不能超过 20MB。",
    );
  }
  const originalName = path.basename(file.filename || "file").slice(0, 255);
  const ext = isImage
    ? {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
      }[file.mimetype]!
    : path
        .extname(originalName)
        .slice(0, 16)
        .replace(/[^.\w-]/g, "") || ".bin";
  const now = new Date();
  const folder = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const dir = path.join(env.uploadDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  const stored = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
  fs.writeFileSync(path.join(dir, stored), buffer);
  return {
    url: `/uploads/${folder}/${stored}`,
    name: originalName,
    size: buffer.length,
    mimeType: file.mimetype,
    isImage,
  };
}
