import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { env, ROOT_DIR } from "./env.js";
import { AppError } from "./errors.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerPublicRoutes } from "./routes/public.js";
import { registerChannelRoutes } from "./routes/channel.js";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function allowedOrigins(): string[] {
  return [env.webOrigin, env.publicBaseUrl, "http://localhost:5173", "http://127.0.0.1:5173"].filter(
    Boolean,
  );
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.isProd ? true : { level: "warn" },
    bodyLimit: 10 * 1024 * 1024,
    trustProxy: true,
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins().includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  });
  await app.register(multipart, {
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  });

  fs.mkdirSync(env.uploadDir, { recursive: true });
  await app.register(fastifyStatic, {
    root: env.uploadDir,
    prefix: "/uploads/",
    decorateReply: false,
    cacheControl: true,
    maxAge: "7d",
  });

  app.addHook("onRequest", async (request) => {
    if (!MUTATING.has(request.method)) return;
    const origin = request.headers.origin;
    if (origin && !allowedOrigins().includes(origin)) {
      throw new AppError(403, "ORIGIN_NOT_ALLOWED", "请求来源不被允许。");
    }
  });

  await registerPublicRoutes(app);
  await registerAdminRoutes(app);
  await registerChannelRoutes(app);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: error.issues[0]?.message || "请求参数不正确。",
          details: error.issues,
        },
      });
    }
    const err = error as Error & { statusCode?: number };
    const status = err.statusCode;
    if (status && status < 500) {
      return reply.status(status).send({
        error: { code: "BAD_REQUEST", message: err.message },
      });
    }
    request.log.error(error);
    return reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "服务器开小差了，请稍后再试。" },
    });
  });

  const webDist = path.join(ROOT_DIR, "web", "dist");
  if (fs.existsSync(path.join(webDist, "index.html"))) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
      wildcard: false,
      decorateReply: false,
    });
    app.setNotFoundHandler((request, reply) => {
      if (
        request.raw.url?.startsWith("/api/") ||
        request.raw.url?.startsWith("/uploads/") ||
        request.raw.url?.startsWith("/socket.io/")
      ) {
        return reply.status(404).send({ error: { code: "NOT_FOUND", message: "接口不存在。" } });
      }
      return reply.type("text/html").send(fs.createReadStream(path.join(webDist, "index.html")));
    });
  }

  return app;
}
