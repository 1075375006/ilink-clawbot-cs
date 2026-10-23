import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Server } from "socket.io";
import { io as connect, type Socket } from "socket.io-client";

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "ilink-support-test-"));
process.env.DATABASE_PATH = path.join(testDir, "test.db");
process.env.UPLOAD_DIR = path.join(testDir, "uploads");
process.env.ILINK_MODE = "demo";
process.env.OAUTH_APPID = "";
process.env.OAUTH_APPKEY = "";
process.env.BEICHEN_APPID = "";
process.env.BEICHEN_APPKEY = "";
process.env.ADMIN_EMAIL = "admin@support-test.local";
process.env.ADMIN_PASSWORD = "support-test-password";
process.env.SESSION_SECRET = "support-tests-only-secret-at-least-32-characters";
const { openDatabase, closeDatabase, migrate } = await import("../src/db.js");
const { seedDemoData } = await import("../src/seed.js");
const { buildApp } = await import("../src/app.js");
const { signSession, verifySession, verifySupportSession } =
  await import("../src/util/crypto.js");
const { configureRealtimeAuth } = await import("../src/realtime-auth.js");
const { emitToAdmins, setRealtime } = await import("../src/realtime.js");
const db = openDatabase();
seedDemoData(db, { force: true });
const app = await buildApp();
const adminCookie = `ilink_session=${signSession({ adminId: 1, email: "admin@support-test.local", name: "管理员" })}`;
let agentId = 0;
let staffCookie = "";
const http = createServer();
const socketServer = new Server(http);
configureRealtimeAuth(socketServer);
setRealtime(socketServer);
let socketUrl = "";
const clients: Socket[] = [];
const cookieOf = (headers: Record<string, unknown>) =>
  String(headers["set-cookie"]).split(";")[0]!;

beforeAll(async () => {
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  socketUrl = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(async () => {
  clients.forEach((client) => client.disconnect());
  await new Promise<void>((resolve) => socketServer.close(() => resolve()));
  await app.close();
  closeDatabase();
  fs.rmSync(testDir, { recursive: true, force: true });
});

async function login(password = "StaffPass123!") {
  return app.inject({
    method: "POST",
    url: "/api/support/auth/login",
    payload: { username: "KEFU01", password },
  });
}
async function socketConnect(cookie: string, portal = "support") {
  const client = connect(socketUrl, {
    auth: { portal },
    extraHeaders: { cookie },
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
  });
  clients.push(client);
  await new Promise<void>((resolve, reject) => {
    client.once("connect", resolve);
    client.once("connect_error", reject);
  });
  return client;
}

describe("independent support accounts", () => {
  it("requires administrator access to create accounts", async () => {
    const denied = await app.inject({
      method: "POST",
      url: "/api/support-agents",
      payload: { username: "kefu01", name: "小林", password: "StaffPass123!" },
    });
    expect(denied.statusCode).toBe(401);
    const created = await app.inject({
      method: "POST",
      url: "/api/support-agents",
      headers: { cookie: adminCookie },
      payload: { username: "kefu01", name: "小林", password: "StaffPass123!" },
    });
    expect(created.statusCode).toBe(200);
    agentId = created.json().agent.id;
    expect(created.json().agent).toMatchObject({
      username: "kefu01",
      name: "小林",
      enabled: true,
    });
    expect(created.body).not.toContain("password");
    const stored = db
      .prepare("SELECT password_hash FROM support_agents WHERE id = ?")
      .get(agentId) as { password_hash: string };
    expect(stored.password_hash).toMatch(/^scrypt\$/);
  });
  it("validates weak passwords and case-insensitive duplicate usernames", async () => {
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/support-agents",
      headers: { cookie: adminCookie },
      payload: { username: "KeFu01", name: "重复", password: "AnotherPass123" },
    });
    expect(duplicate.statusCode).toBe(409);
    const weak = await app.inject({
      method: "POST",
      url: "/api/support-agents",
      headers: { cookie: adminCookie },
      payload: { username: "kefu02", name: "小陈", password: "123" },
    });
    expect(weak.statusCode).toBe(400);
  });
  it("uses a separate httpOnly session cookie and never exposes a password hash", async () => {
    const response = await login();
    expect(response.statusCode).toBe(200);
    staffCookie = cookieOf(response.headers);
    expect(staffCookie).toMatch(/^ilink_support_session=/);
    expect(String(response.headers["set-cookie"])).toContain("HttpOnly");
    expect(response.body).not.toContain("scrypt");
    expect(response.json().agent.lastLoginAt).toBeTruthy();
    const me = await app.inject({
      method: "GET",
      url: "/api/support/auth/me",
      headers: { cookie: staffCookie },
    });
    expect(me.json().agent.username).toBe("kefu01");
    const adminMe = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: staffCookie },
    });
    expect(adminMe.json().admin).toBeNull();
  });
  it("refuses admin cookies on support routes and support tokens in the admin cookie", async () => {
    const denied = await app.inject({
      method: "GET",
      url: "/api/support/conversations",
      headers: { cookie: adminCookie },
    });
    expect(denied.statusCode).toBe(401);
    const token = staffCookie.split("=")[1]!;
    expect(verifySession(token)).toBeNull();
    expect(verifySupportSession(adminCookie.split("=")[1]!)).toBeNull();
    const forged = await app.inject({
      method: "GET",
      url: "/api/dashboard",
      headers: { cookie: `ilink_session=${token}` },
    });
    expect(forged.statusCode).toBe(401);
  });
  it("keeps both portal sessions independent in the same browser", async () => {
    const cookie = `${adminCookie}; ${staffCookie}`;
    const admin = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie },
    });
    const staff = await app.inject({
      method: "GET",
      url: "/api/support/auth/me",
      headers: { cookie },
    });
    expect(admin.json().admin.id).toBe(1);
    expect(staff.json().agent.id).toBe(agentId);
    const logout = await app.inject({
      method: "POST",
      url: "/api/support/auth/logout",
      headers: { cookie },
    });
    expect(String(logout.headers["set-cookie"])).toContain(
      "ilink_support_session=",
    );
    expect(String(logout.headers["set-cookie"])).not.toMatch(
      /(?:^|;)\s*ilink_session=/,
    );
  });
  it("restricts staff to conversation APIs", async () => {
    for (const url of [
      "/api/dashboard",
      "/api/channel",
      "/api/keepalive",
      "/api/support-agents",
      "/api/push/history",
    ]) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: { cookie: staffCookie },
      });
      expect(response.statusCode).toBe(401);
    }
    const list = await app.inject({
      method: "GET",
      url: "/api/support/conversations",
      headers: { cookie: staffCookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.length).toBeGreaterThan(0);
    expect(list.body).not.toContain("context_token");
    expect(list.body).not.toContain("bot_token");
  });
  it("supports history, read acknowledgements and real shared send service", async () => {
    const history = await app.inject({
      method: "GET",
      url: "/api/support/users/2/messages?limit=10",
      headers: { cookie: staffCookie },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().items.length).toBeGreaterThan(0);
    const sent = await app.inject({
      method: "POST",
      url: "/api/support/users/2/messages",
      headers: { cookie: staffCookie },
      payload: { content: "客服独立工作台测试" },
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().message.content).toBe("客服独立工作台测试");
    const read = await app.inject({
      method: "POST",
      url: "/api/support/users/2/read",
      headers: { cookie: staffCookie },
    });
    expect(read.statusCode).toBe(200);
  });
  it("authenticates uploads and handles image and file attachments safely", async () => {
    const boundary = "support-upload-boundary";
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="note.html"\r\nContent-Type: text/html\r\n\r\n<html>test</html>\r\n--${boundary}--\r\n`,
    );
    const headers = {
      cookie: staffCookie,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/support/uploads",
          headers: { "content-type": headers["content-type"] },
          payload,
        })
      ).statusCode,
    ).toBe(401);
    const uploaded = await app.inject({
      method: "POST",
      url: "/api/support/uploads",
      headers,
      payload,
    });
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.json()).toMatchObject({
      name: "note.html",
      isImage: false,
      mimeType: "text/html",
    });
    const file = await app.inject({ method: "GET", url: uploaded.json().url });
    expect(file.headers["content-disposition"]).toBe("attachment");
    expect(file.headers["content-security-policy"]).toBe("sandbox");
    expect(file.headers["x-content-type-options"]).toBe("nosniff");

    const imagePayload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="pixel.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lqkAAAAASUVORK5CYII=",
        "base64",
      ),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const image = await app.inject({
      method: "POST",
      url: "/api/support/uploads",
      headers,
      payload: imagePayload,
    });
    expect(image.statusCode).toBe(200);
    expect(image.json().isImage).toBe(true);
    db.prepare("UPDATE users SET window_msg_count = 0 WHERE id = 2").run();
    const sent = await app.inject({
      method: "POST",
      url: "/api/support/users/2/messages",
      headers: { cookie: staffCookie },
      payload: { content: "", msgType: "image", mediaUrl: image.json().url },
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().message.type).toBe("image");
  });
  it("accepts files over 8MB but rejects images over 8MB", async () => {
    const boundary = "support-size-test";
    for (const [filename, mime, expected] of [
      ["large.txt", "text/plain", 200],
      ["large.png", "image/png", 413],
    ] as const) {
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
        ),
        Buffer.alloc(9 * 1024 * 1024, 65),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const response = await app.inject({
        method: "POST",
        url: "/api/support/uploads",
        headers: {
          cookie: staffCookie,
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });
      expect(response.statusCode).toBe(expected);
    }
  });
  it("prevents concurrent admin/staff sends spending the same final quota slot", async () => {
    db.prepare("UPDATE users SET window_msg_count = 9 WHERE id = 2").run();
    const results = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/support/users/2/messages",
        headers: { cookie: staffCookie },
        payload: { content: "最后一条客服回复" },
      }),
      app.inject({
        method: "POST",
        url: "/api/users/2/messages",
        headers: { cookie: adminCookie },
        payload: { content: "管理员同时回复" },
      }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 400]);
    expect(results.find((r) => r.statusCode === 400)?.json().error.code).toBe(
      "ERR_QUOTA_EXCEEDED",
    );
  });
  it("uses safe socket rooms and never sends admin-only events to support", async () => {
    const client = await socketConnect(staffCookie);
    const remote = socketServer.sockets.sockets.get(client.id!);
    expect(remote?.rooms.has("support")).toBe(true);
    expect(remote?.rooms.has("admins")).toBe(false);
    expect(remote?.rooms.has(`support:${agentId}`)).toBe(true);
    let leaked = false;
    client.on("binding:updated", () => {
      leaked = true;
    });
    const delivered = new Promise<unknown>((resolve) =>
      client.once("conversation:updated", resolve),
    );
    emitToAdmins("binding:updated", { token: "admin-only-token" });
    emitToAdmins("conversation:updated", { userId: 2 });
    expect(await delivered).toEqual({ userId: 2 });
    expect(leaked).toBe(false);
    client.disconnect();
  });
  it("does not allow support credentials to join the admin socket portal", async () => {
    await expect(
      socketConnect(
        staffCookie.replace("ilink_support_session=", "ilink_session="),
        "admin",
      ),
    ).rejects.toThrow("UNAUTHORIZED");
  });
  it("revokes REST sessions and live sockets immediately on disable", async () => {
    const client = await socketConnect(staffCookie);
    const disconnected = new Promise<void>((resolve) =>
      client.once("disconnect", () => resolve()),
    );
    const response = await app.inject({
      method: "PATCH",
      url: `/api/support-agents/${agentId}`,
      headers: { cookie: adminCookie },
      payload: { enabled: false },
    });
    expect(response.statusCode).toBe(200);
    await disconnected;
    const denied = await app.inject({
      method: "GET",
      url: "/api/support/conversations",
      headers: { cookie: staffCookie },
    });
    expect(denied.statusCode).toBe(401);
    expect((await login()).statusCode).toBe(403);
    await app.inject({
      method: "PATCH",
      url: `/api/support-agents/${agentId}`,
      headers: { cookie: adminCookie },
      payload: { enabled: true },
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/support/conversations",
          headers: { cookie: staffCookie },
        })
      ).statusCode,
    ).toBe(401);
    staffCookie = cookieOf((await login()).headers);
  });
  it("invalidates old sessions on password reset and preserves customer data", async () => {
    const counts = db.prepare("SELECT COUNT(*) AS n FROM messages").get();
    const response = await app.inject({
      method: "POST",
      url: `/api/support-agents/${agentId}/password`,
      headers: { cookie: adminCookie },
      payload: { password: "NewStaffPass456!" },
    });
    expect(response.statusCode).toBe(200);
    const me = await app.inject({
      method: "GET",
      url: "/api/support/auth/me",
      headers: { cookie: staffCookie },
    });
    expect(me.json().agent).toBeNull();
    expect((await login()).statusCode).toBe(401);
    expect((await login("NewStaffPass456!")).statusCode).toBe(200);
    expect(db.prepare("SELECT COUNT(*) AS n FROM messages").get()).toEqual(
      counts,
    );
  });
  it("is an idempotent additive migration", () => {
    migrate(db);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM support_agents").get(),
    ).toEqual({ n: 1 });
    expect(
      db
        .prepare(
          "SELECT version FROM schema_migrations WHERE version = '20261023_001'",
        )
        .get(),
    ).toBeTruthy();
  });
});
