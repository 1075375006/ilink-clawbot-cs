import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRow } from "../src/db.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ilink-test-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.UPLOAD_DIR = path.join(tmpDir, "uploads");
process.env.SESSION_SECRET = "test-session-secret-please-change";
process.env.ADMIN_EMAIL = "admin@test.local";
process.env.ADMIN_PASSWORD = "test-password";
process.env.PUBLIC_BASE_URL = "http://localhost:3001";
process.env.WEB_ORIGIN = "http://localhost:5173";
process.env.SEED_DEMO = "true";

const { openDatabase, closeDatabase, getDb } = await import("../src/db.js");
const { seedDemoData } = await import("../src/seed.js");
const { buildApp } = await import("../src/app.js");
const { isSilentNow, windowRemainingSeconds, addHours } = await import("../src/util/time.js");
const { renderKeepaliveTemplate, runKeepalive, getKeepaliveConfig, evaluateCandidate } = await import(
  "../src/services/keepalive.js"
);
const { splitTextByBytes, insertInbound } = await import("../src/services/messages.js");

const db = openDatabase();
seedDemoData(db, { force: true });
const app = await buildApp();
let cookie = "";

function authHeaders() {
  return { cookie };
}

beforeAll(async () => {
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "admin@test.local", password: "test-password" },
  });
  expect(login.statusCode).toBe(200);
  const raw = login.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  cookie = String(value).split(";")[0] ?? "";
  expect(cookie).toContain("ilink_session=");
});

afterAll(async () => {
  await app.close();
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("security and auth", () => {
  it("rejects unauthenticated admin APIs", async () => {
    const response = await app.inject({ method: "GET", url: "/api/users" });
    expect(response.statusCode).toBe(401);
  });

  it("does not leak the password hash", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: authHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("scrypt");
    expect(JSON.parse(response.body).admin.email).toBe("admin@test.local");
  });

  it("returns an empty session for public visitors", async () => {
    const response = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).admin).toBeNull();
  });
});

describe("dashboard and customer data", () => {
  it("returns dashboard stats and a seven-day trend", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/dashboard",
      headers: authHeaders(),
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.trend).toHaveLength(7);
    expect(body.stats.pendingReplies).toBeGreaterThan(0);
    expect(body.stats.activeConversations).toBeGreaterThan(0);
  });

  it("lists only bound customers and paginates", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/users?page=1&pageSize=5",
      headers: authHeaders(),
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.items).toHaveLength(5);
    expect(body.total).toBeGreaterThanOrEqual(12);
    body.items.forEach((user: { status: string }) => expect(user.status).toBe("bound"));
  });

  it("filters customers by nickname", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/users?search=${encodeURIComponent("林薇")}`,
      headers: authHeaders(),
    });
    const body = JSON.parse(response.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("林薇");
  });
});

describe("binding and beichen oauth", () => {
  it("runs the demo oauth → clawbot bind → customer list flow", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/public/bind/sessions",
    });
    expect(created.statusCode).toBe(200);
    const session = JSON.parse(created.body);
    expect(session.token).toBeTruthy();
    expect(session.mode).toBe("demo");

    const initial = await app.inject({
      method: "GET",
      url: `/api/public/bind/${session.token}`,
    });
    const initialBody = JSON.parse(initial.body);
    expect(initialBody.status).toBe("awaiting_oauth");
    expect(initialBody.oauthUrl).toContain("/api/oauth/entry?state=");

    const state = new URL(initialBody.oauthUrl).searchParams.get("state");
    expect(state).toBeTruthy();
    const callback = await app.inject({
      method: "GET",
      url: `/api/oauth/callback?state=${encodeURIComponent(state!)}&code=demo-code&type=wx&format=json`,
    });
    expect(callback.statusCode).toBe(200);
    const result = JSON.parse(callback.body);
    expect(result.ok).toBe(true);

    const pendingCustomer = await app.inject({
      method: "GET",
      url: `/api/users/${result.userId}`,
      headers: authHeaders(),
    });
    expect(JSON.parse(pendingCustomer.body).user.status).toBe("pending");
    const visibleBeforeBind = await app.inject({
      method: "GET",
      url: "/api/users",
      headers: authHeaders(),
    });
    expect(
      JSON.parse(visibleBeforeBind.body).items.some(
        (item: { id: number }) => item.id === result.userId,
      ),
    ).toBe(false);

    const scanned = await app.inject({
      method: "POST",
      url: `/api/public/bind/${session.token}/simulate-scan`,
    });
    expect(scanned.statusCode).toBe(200);
    expect(JSON.parse(scanned.body).status).toBe("completed");

    const customer = await app.inject({
      method: "GET",
      url: `/api/users/${result.userId}`,
      headers: authHeaders(),
    });
    const user = JSON.parse(customer.body).user;
    expect(user.status).toBe("bound");
    expect(user.name).toBeTruthy();
    expect(user.socialUid).toMatch(/^bc_demo_/);
    expect(user.windowState).toBe("open");

    // Once they speak, the conversation appears and the window opens.
    const inbound = await app.inject({
      method: "POST",
      url: "/api/channel/demo/inbound",
      headers: authHeaders(),
      payload: { userId: result.userId, content: "你好，我想咨询一下。" },
    });
    expect(inbound.statusCode).toBe(200);
    const refreshed = await app.inject({
      method: "GET",
      url: `/api/users/${result.userId}`,
      headers: authHeaders(),
    });
    expect(JSON.parse(refreshed.body).user.windowState).toBe("open");
  });

  it("rejects an invalid oauth state", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/oauth/callback?state=not-a-real-state&code=x&format=json",
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe("INVALID_STATE");
  });

  it("redirects legacy branded oauth routes to the provider-neutral paths", async () => {
    const entry = await app.inject({
      method: "GET",
      url: "/api/oauth/beichen/entry?state=abcdefgh",
    });
    expect(entry.statusCode).toBe(302);
    expect(entry.headers.location).toBe("/api/oauth/entry?state=abcdefgh");

    const callback = await app.inject({
      method: "GET",
      url: "/api/oauth/beichen/callback?state=abcdefgh&code=code-1&type=wx",
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe(
      "/api/oauth/callback?state=abcdefgh&code=code-1&type=wx",
    );
  });

  it("exposes the configured oauth provider", async () => {
    const response = await app.inject({ method: "GET", url: "/api/system/info" });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).oauthProvider).toBe("suyanw");
  });
});

describe("messaging rules", () => {
  it("blocks messages after the 24h window closes", async () => {
    const closed = getDb()
      .prepare("SELECT id FROM users WHERE status = 'bound' AND last_active_at < ? LIMIT 1")
      .get(addHours(new Date(), -25)) as { id: number } | undefined;
    expect(closed).toBeTruthy();
    const response = await app.inject({
      method: "POST",
      url: `/api/users/${closed!.id}/messages`,
      headers: authHeaders(),
      payload: { content: "测试超时消息" },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe("ERR_WINDOW_EXPIRED");
  });

  it("enforces the per-window reply quota", async () => {
    const detail = await app.inject({
      method: "GET",
      url: "/api/users/1",
      headers: authHeaders(),
    });
    const remaining = JSON.parse(detail.body).user.replyRemaining as number;
    expect(remaining).toBeGreaterThan(0);
    for (let index = 0; index < remaining; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/users/1/messages",
        headers: authHeaders(),
        payload: { content: `配额测试 ${index + 1}` },
      });
      expect(response.statusCode).toBe(200);
    }
    const blocked = await app.inject({
      method: "POST",
      url: "/api/users/1/messages",
      headers: authHeaders(),
      payload: { content: "超出配额" },
    });
    expect(blocked.statusCode).toBe(400);
    expect(JSON.parse(blocked.body).error.code).toBe("ERR_QUOTA_EXCEEDED");
  });

  it("segments text larger than 16KiB into independent messages", async () => {
    const content = "字".repeat(6000);
    const segments = splitTextByBytes(content);
    expect(segments.length).toBe(2);
    segments.forEach((segment) => expect(Buffer.byteLength(segment, "utf8")).toBeLessThanOrEqual(16_384));
    const response = await app.inject({
      method: "POST",
      url: "/api/users/2/messages",
      headers: authHeaders(),
      payload: { content },
    });
    expect(response.statusCode).toBe(200);
    const rows = getDb()
      .prepare("SELECT content FROM messages WHERE user_id = 2 AND direction = 'outbound' ORDER BY id DESC LIMIT 2")
      .all() as Array<{ content: string }>;
    expect(rows).toHaveLength(2);
    rows.forEach((row) => expect(Buffer.byteLength(row.content, "utf8")).toBeLessThanOrEqual(16_384));
  });

  it("resets the 10-message quota when the customer speaks", async () => {
    const before = await app.inject({
      method: "GET",
      url: "/api/users/2",
      headers: authHeaders(),
    });
    expect(JSON.parse(before.body).user.replyUsed).toBeGreaterThan(0);
    const inbound = await app.inject({
      method: "POST",
      url: "/api/channel/demo/inbound",
      headers: authHeaders(),
      payload: { userId: 2, content: "我又来咨询啦" },
    });
    expect(inbound.statusCode).toBe(200);
    const after = await app.inject({
      method: "GET",
      url: "/api/users/2",
      headers: authHeaders(),
    });
    expect(JSON.parse(after.body).user.replyUsed).toBe(0);
  });
});

describe("push and keepalive", () => {
  it("reports unreachable recipients before sending", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/push/preview",
      headers: authHeaders(),
      payload: { userIds: [2, 13] },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.reachable).toBe(1);
    expect(body.unreachable).toBe(1);
  });

  it("sends only to reachable recipients and records the campaign", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/push",
      headers: authHeaders(),
      payload: { userIds: [2, 13], content: "本周会员日提醒", msgType: "text" },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.sent).toBe(1);
    expect(body.skipped).toBe(1);
    expect(body.failed).toBe(0);
  });

  it("renders nickname variables and rejects external links", async () => {
    expect(renderKeepaliveTemplate("您好{nickname_suffix}！", "林薇")).toBe("您好，林薇！");
    expect(renderKeepaliveTemplate("您好{nickname}", "")).toBe("您好");
    const response = await app.inject({
      method: "PUT",
      url: "/api/keepalive/config",
      headers: authHeaders(),
      payload: {
        enabled: true,
        thresholdHours: 20,
        msgTemplate: "点这里 https://example.com",
        maxPerDay: 1,
        quotaWarnAt: 1,
        silentStart: "23:00",
        silentEnd: "08:00",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe("TEMPLATE_LINK");
  });

  it("detects silent hours that cross midnight", () => {
    expect(isSilentNow("23:00", "08:00", new Date("2026-10-20T15:30:00Z"))).toBe(true);
    expect(isSilentNow("23:00", "08:00", new Date("2026-10-20T04:00:00Z"))).toBe(false);
    expect(isSilentNow("23:00", "08:00", new Date("2026-10-20T23:30:00Z"))).toBe(true);
  });

  it("finds customers past the threshold and reports a dry run", async () => {
    const result = await runKeepalive({ dryRun: true });
    expect(result.checked).toBeGreaterThan(0);
    expect(result.eligible).toBeGreaterThan(0);
    const config = getKeepaliveConfig();
    expect(config.threshold_hours).toBe(20);
  });

  it("triggers keepalive when only one quota slot remains", () => {
    const config = getKeepaliveConfig();
    getDb()
      .prepare("UPDATE users SET window_msg_count = 9, last_active_at = ? WHERE id = 2")
      .run(new Date(Date.now() - 60 * 60 * 1000).toISOString());
    const fresh = getDb().prepare("SELECT * FROM users WHERE id = 2").get() as UserRow;
    const candidate = evaluateCandidate(fresh, config);
    expect(candidate.eligible).toBe(true);
    expect(candidate.reason).toBe("eligible");

    getDb().prepare("UPDATE users SET window_msg_count = 10 WHERE id = 2").run();
    const full = getDb().prepare("SELECT * FROM users WHERE id = 2").get() as UserRow;
    expect(evaluateCandidate(full, config).reason).toBe("quota_full");
  });

  it("uses the 24h window math consistently", () => {
    const lastActive = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(windowRemainingSeconds(lastActive)).toBeGreaterThan(82_000);
    expect(windowRemainingSeconds(addHours(new Date(), -25))).toBe(0);
  });

  it("creates, toggles and deletes scheduled keepalive tasks", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/keepalive/schedules",
      headers: authHeaders(),
      payload: {
        cronExpr: "0 10 * * *",
        message: "您好{nickname_suffix}，今天需要帮忙吗？",
        mediaType: "text",
      },
    });
    expect(created.statusCode).toBe(200);
    const item = JSON.parse(created.body).item;
    expect(item.cron_expr).toBe("0 10 * * *");

    const toggled = await app.inject({
      method: "PATCH",
      url: `/api/keepalive/schedules/${item.id}`,
      headers: authHeaders(),
      payload: { enabled: false },
    });
    expect(toggled.statusCode).toBe(200);
    expect(JSON.parse(toggled.body).item.enabled).toBe(0);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/keepalive/schedules/${item.id}`,
      headers: authHeaders(),
    });
    expect(deleted.statusCode).toBe(200);
  });
});

describe("media messages", () => {
  it("persists inbound files with their media metadata", () => {
    const row = insertInbound(2, {
      openid: "demo_openid_2",
      text: "这是合同",
      images: [],
      files: [
        {
          url: "/uploads/inbound/files/contract.pdf",
          filePath: "/tmp/contract.pdf",
          name: "contract.pdf",
          size: 2048,
          mime: "application/pdf",
        },
      ],
      contextToken: "ctx_media_test",
      ilinkMsgId: "ilink_media_test_1",
      messageId: "media_test_1",
      clientId: null,
      at: new Date().toISOString(),
    });
    expect(row).toBeTruthy();
    expect(row!.msg_type).toBe("file");
    expect(row!.content).toBe("这是合同");
    expect(row!.media_url).toBe("/uploads/inbound/files/contract.pdf");
    expect(row!.media_name).toBe("contract.pdf");
    expect(row!.media_size).toBe(2048);
    expect(row!.media_mime).toBe("application/pdf");
  });

  it("requires media for file pushes", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/push",
      headers: authHeaders(),
      payload: { userIds: [2], content: "", msgType: "file" },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe("MEDIA_REQUIRED");
  });

  it("sends and records an outbound file message in demo mode", async () => {
    const uploadDir = process.env.UPLOAD_DIR!;
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, "quote.txt"), "hello file");
    const response = await app.inject({
      method: "POST",
      url: "/api/users/2/messages",
      headers: authHeaders(),
      payload: {
        content: "报价单请查收",
        msgType: "file",
        mediaUrl: "/uploads/quote.txt",
        mediaName: "报价单.txt",
        mediaSize: 10,
        mediaMime: "text/plain",
      },
    });
    expect(response.statusCode).toBe(200);
    const message = JSON.parse(response.body).message;
    expect(message.type).toBe("file");
    expect(message.mediaName).toBe("报价单.txt");
    expect(message.mediaMime).toBe("text/plain");
    expect(message.content).toBe("报价单请查收");
  });
});
