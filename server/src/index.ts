import { buildApp } from "./app.js";
import { env } from "./env.js";
import { ensureBaseConfig, openDatabase } from "./db.js";
import { ensureAdmin, seedDemoData } from "./seed.js";
import { gateway } from "./ilink/gateway.js";
import { handleInbound, handleInboundForUser, pruneMessages } from "./services/messages.js";
import { channelRow } from "./services/channel.js";
import { setRealtime } from "./realtime.js";
import { startScheduler, stopScheduler } from "./scheduler.js";
import { configureRealtimeAuth } from "./realtime-auth.js";
import { resumeBindingPollers } from "./services/binding.js";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";

const db = openDatabase();
ensureBaseConfig(db);
pruneMessages();
if (env.seedDemo && env.ilink.mode === "demo") seedDemoData(db);
ensureAdmin(db);

if (env.isProd) {
  if (env.sessionSecret.includes("dev-only-insecure")) {
    console.warn("[security] SESSION_SECRET 仍为开发默认值，请立即更换。");
  }
  if (/^0+$/.test(env.credentialKey)) {
    console.warn("[security] ILINK_CREDENTIAL_KEY 仍为全零默认值，请配置 32 字节随机密钥。");
  }
  if (env.admin.password === "admin123456") {
    console.warn("[security] 管理员仍使用默认密码，请修改 ADMIN_PASSWORD。");
  }
}

const app = await buildApp();
gateway.setInboundHandler(handleInbound);
gateway.setUserInboundHandler(handleInboundForUser);

await app.listen({ port: env.port, host: "0.0.0.0" });

const io = new Server(app.server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowed = [env.webOrigin, env.publicBaseUrl, "http://localhost:5173"]
        .filter(Boolean)
        .includes(origin);
      callback(null, allowed);
    },
    credentials: true,
  },
});

try {
  const pubClient = new Redis(env.redisUrl, { maxRetriesPerRequest: 1 });
  const subClient = pubClient.duplicate();
  pubClient.on("error", () => undefined);
  subClient.on("error", () => undefined);
  io.adapter(createAdapter(pubClient, subClient));
} catch (error) {
  console.warn("[redis] Socket.IO adapter unavailable:", error);
}

configureRealtimeAuth(io);

setRealtime(io);
startScheduler();

const channel = channelRow();
if (channel.mode === "live") {
  void gateway.start();
  void gateway.startAllUserBots();
}
resumeBindingPollers();

console.log(`\n  iLink 客服中心已启动`);
console.log(`  API     http://localhost:${env.port}`);
console.log(`  模式    ${channel.mode === "demo" ? "演示通道" : "真实 iLink 通道"}`);
console.log(`  数据库  ${env.databasePath}\n`);

async function shutdown(signal: string): Promise<void> {
  console.log(`[server] ${signal}, shutting down...`);
  stopScheduler();
  gateway.stop();
  io.close();
  await app.close();
  db.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
