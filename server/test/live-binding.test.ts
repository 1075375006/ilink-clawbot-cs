import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { DB } from "../src/db.js";
import { encodeImageAesKey } from "../src/ilink/media.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ilink-live-test-"));
let lastSendHeaders: http.IncomingHttpHeaders = {};
let lastSendBody = "";
const fake = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  res.setHeader("Content-Type", "application/json");
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    if (url.pathname.endsWith("/get_bot_qrcode")) {
      res.end(
        JSON.stringify({
          ret: 0,
          qrcode: "qr-test",
          qrcode_img_content: "https://liteapp.weixin.qq.com/q/test",
        }),
      );
      return;
    }
    if (url.pathname.endsWith("/get_qrcode_status")) {
      res.end(
        JSON.stringify({
          status: "confirmed",
          bot_token: "fake-bot-token",
          ilink_bot_id: "bot@test",
          baseurl: `http://127.0.0.1:${(fake.address() as { port: number }).port}`,
          ilink_user_id: "user@test",
        }),
      );
      return;
    }
    if (url.pathname.endsWith("/getupdates")) {
      setTimeout(() => {
        res.end(JSON.stringify({ ret: 0, msgs: [], get_updates_buf: "" }));
      }, 250);
      return;
    }
    if (url.pathname.endsWith("/sendmessage")) {
      lastSendHeaders = req.headers;
      lastSendBody = body;
      if (body.includes("cause_session_expired")) {
        res.end(JSON.stringify({ ret: -14, errmsg: "session expired" }));
        return;
      }
      if (body.includes("cause_quota")) {
        res.end(JSON.stringify({ ret: 0, errcode: 10, errmsg: "quota exceeded" }));
        return;
      }
    }
    res.end(JSON.stringify({ ret: 0 }));
  });
});

let port = 0;
let db: DB;
let gateway: typeof import("../src/ilink/gateway.js").gateway;
let binding: typeof import("../src/services/binding.js");

beforeAll(async () => {
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  port = (fake.address() as { port: number }).port;
  process.env.DATABASE_PATH = path.join(tmpDir, "live.db");
  process.env.UPLOAD_DIR = path.join(tmpDir, "uploads");
  process.env.ILINK_MODE = "live";
  process.env.ILINK_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.SEED_DEMO = "false";
  process.env.BEICHEN_APPID = "";
  process.env.BEICHEN_APPKEY = "";
  process.env.PUBLIC_BASE_URL = "http://localhost:3001";
  process.env.WEB_ORIGIN = "http://localhost:5173";

  const dbModule = await import("../src/db.js");
  db = dbModule.openDatabase();
  dbModule.ensureBaseConfig(db);
  db.prepare(
    "INSERT INTO admins (email, password_hash, name, created_at, updated_at) VALUES ('a@b.c', 'x', 't', ?, ?)",
  ).run(new Date().toISOString(), new Date().toISOString());
  const gatewayModule = await import("../src/ilink/gateway.js");
  gateway = gatewayModule.gateway;
  binding = await import("../src/services/binding.js");
});

afterAll(async () => {
  gateway?.stop();
  await new Promise<void>((resolve) => fake.close(() => resolve()));
  const { closeDatabase } = await import("../src/db.js");
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

it("authorizes the customer first, then binds a real per-user ClawBot", async () => {
  const session = await binding.createSession();
  expect(session.mode).toBe("live");
  expect(session.token).toBeTruthy();

  let row = db
    .prepare("SELECT * FROM binding_sessions WHERE token = ?")
    .get(session.token) as {
    status: string;
    user_id: number;
    oauth_state: string | null;
    ilink_bot_id: string | null;
    baseurl: string | null;
  };
  expect(row.status).toBe("awaiting_oauth");
  expect(row.oauth_state).toBeTruthy();
  expect(row.ilink_bot_id).toBeNull();

  const result = await binding.completeOAuth({
    state: row.oauth_state!,
    code: "fake-code",
    loginType: "wx",
  });
  const pending = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(result.userId) as {
    status: string;
    social_uid: string;
    ilink_bot_id: string | null;
  };
  expect(pending.status).toBe("pending");
  expect(pending.social_uid).toMatch(/^bc_demo_/);
  expect(pending.ilink_bot_id).toBeNull();

  row = db
    .prepare("SELECT * FROM binding_sessions WHERE token = ?")
    .get(session.token) as typeof row;
  expect(row.status).toBe("scanned");
  expect(row.user_id).toBe(result.userId);

  await new Promise((resolve) => setTimeout(resolve, 2600));

  row = db
    .prepare("SELECT * FROM binding_sessions WHERE token = ?")
    .get(session.token) as typeof row;
  expect(row.status).toBe("completed");
  expect(row.ilink_bot_id).toBe("bot@test");
  expect(row.baseurl).toBe(`http://127.0.0.1:${port}`);

  const bound = db.prepare("SELECT * FROM users WHERE id = ?").get(result.userId) as {
    status: string;
    is_active: number;
    ilink_bot_id: string;
    baseurl: string;
    bound_at: string;
    last_active_at: string;
    social_uid: string;
  };
  expect(bound.status).toBe("bound");
  expect(bound.is_active).toBe(1);
  expect(bound.ilink_bot_id).toBe("bot@test");
  expect(bound.baseurl).toBe(`http://127.0.0.1:${port}`);
  expect(bound.bound_at).toBeTruthy();
  expect(bound.last_active_at).toBeTruthy();

  const { IlinkApi } = await import("../src/ilink/api.js");
  const api = new IlinkApi(`http://127.0.0.1:${port}`, "fake-bot-token");
  const clientId = await api.sendText("user@test", "header-check", "ctx-test");
  expect(clientId).toMatch(/^ilink:\d+-[0-9a-f]{8}$/);
  expect(lastSendBody).toContain("ilink:");
  expect(lastSendHeaders["ilink-app-id"]).toBe("bot");
  expect(lastSendHeaders["ilink-app-clientversion"]).toBe("65538");
  expect(lastSendHeaders.authorizationtype).toBe("ilink_bot_token");
  expect(lastSendHeaders.authorization).toBe("Bearer fake-bot-token");
  expect(lastSendHeaders["x-wechat-uin"]).toBeTruthy();

  const messagesService = await import("../src/services/messages.js");
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE users SET last_active_at = ?, window_expires_at = ?, context_token = ?,
       window_msg_count = 0 WHERE id = ?`,
  ).run(now, new Date(Date.now() + 86_400_000).toISOString(), "ctx-test", result.userId);

  await expect(
    messagesService.sendOutbound(result.userId, { content: "cause_session_expired" }),
  ).rejects.toMatchObject({ code: "ERR_BOT_INVALID" });
  const expired = db.prepare("SELECT * FROM users WHERE id = ?").get(result.userId) as {
    account_status: string;
    is_active: number;
    social_uid: string;
  };
  expect(expired.account_status).toBe("session_expired");
  expect(expired.is_active).toBe(0);
  expect(expired.social_uid).toBe(bound.social_uid);

  db.prepare(
    `UPDATE users SET account_status = 'active', is_active = 1, window_msg_count = 0,
       last_active_at = ?, window_expires_at = ?, context_token = 'ctx-test' WHERE id = ?`,
  ).run(now, new Date(Date.now() + 86_400_000).toISOString(), result.userId);
  await expect(
    messagesService.sendOutbound(result.userId, { content: "cause_quota" }),
  ).rejects.toMatchObject({ code: "ERR_QUOTA_EXCEEDED" });
  const exhausted = db.prepare("SELECT window_msg_count FROM users WHERE id = ?").get(result.userId) as {
    window_msg_count: number;
  };
  expect(exhausted.window_msg_count).toBe(10);
});

it("encodes image media aes_key as base64 of the hex key", () => {
  const raw = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const wire = encodeImageAesKey(raw);
  expect(Buffer.from(wire, "base64").toString("ascii")).toBe(
    "00112233445566778899aabbccddeeff",
  );
  expect(wire).not.toBe(raw.toString("base64"));
});
