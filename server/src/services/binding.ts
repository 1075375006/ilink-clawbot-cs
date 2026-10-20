import crypto from "node:crypto";
import QRCode from "qrcode";
import { getDb, type BindingSessionRow, type MessageRow, type UserRow } from "../db.js";
import { env, beichenRedirectUri } from "../env.js";
import { AppError, notFound } from "../errors.js";
import { gateway } from "../ilink/gateway.js";
import { getBindingQr, pollBindingQr, type BindingQrStatus } from "../ilink/qr.js";
import { emitToAdmins } from "../realtime.js";
import { encryptSecret, randomToken } from "../util/crypto.js";
import { deleteQrMapping, getQrMapping, setQrMapping } from "../redis.js";
import { addHours, addMinutes, isPast, nowIso } from "../util/time.js";
import { beichenConfigured, exchangeCode, getLoginUrl, queryUser, type BeichenIdentity } from "./beichen.js";
import { getUserView } from "./users.js";

const MOCK_NAMES = ["唐可", "陆星河", "周柠", "蒋南", "苏木", "邵一", "程橙", "白露"];

function hashIndex(value: string, length: number): number {
  const digest = crypto.createHash("sha256").update(value).digest();
  return digest.readUInt32BE(0) % length;
}

function mockIdentity(state: string): BeichenIdentity {
  const index = hashIndex(state, MOCK_NAMES.length);
  const name = MOCK_NAMES[index]!;
  return {
    social_uid: `bc_demo_${crypto.createHash("sha256").update(state).digest("hex").slice(0, 16)}`,
    nickname: name,
    faceimg: `/api/avatar/${encodeURIComponent(name)}`,
    login_type: "wx",
  };
}

export function expireStaleSessions(): void {
  getDb()
    .prepare(
      `UPDATE binding_sessions SET status = 'expired', poll_status = 'expired'
       WHERE status IN ('pending', 'awaiting_oauth') AND expires_at < ?`,
    )
    .run(nowIso());
}

export function getSession(token: string): BindingSessionRow {
  expireStaleSessions();
  const row = getDb()
    .prepare("SELECT * FROM binding_sessions WHERE token = ?")
    .get(token) as BindingSessionRow | undefined;
  if (!row) throw notFound("绑定链接不存在或已失效。");
  return row;
}

function oauthEntryUrl(state: string): string {
  return `${env.publicBaseUrl}/api/oauth/beichen/entry?state=${encodeURIComponent(state)}`;
}

function webBaseUrl(): string {
  return (env.webOrigin || env.publicBaseUrl).replace(/\/+$/, "");
}

export async function createSession(): Promise<{
  token: string;
  expiresAt: string;
  mode: "demo" | "live";
  qrDataUrl: string | null;
  bindUrl: string;
}> {
  expireStaleSessions();
  const token = randomToken(18);
  const now = new Date();
  const channel = getDb().prepare("SELECT mode FROM channel_config WHERE id = 1").get() as {
    mode: "demo" | "live";
  };
  const expiresAt = addMinutes(now, 10);
  const oauthState = randomToken(24);
  getDb()
    .prepare(
      `INSERT INTO binding_sessions (token, status, oauth_state, created_at, expires_at)
       VALUES (?, 'awaiting_oauth', ?, ?, ?)`,
    )
    .run(token, oauthState, now.toISOString(), expiresAt);
  const bindUrl = `${webBaseUrl()}/bind?token=${token}`;
  return {
    token,
    expiresAt,
    mode: channel.mode,
    qrDataUrl: null,
    bindUrl,
  };
}

export async function qrForSession(token: string): Promise<Buffer> {
  const session = getSession(token);
  const channel = getDb().prepare("SELECT mode FROM channel_config WHERE id = 1").get() as {
    mode: "demo" | "live";
  };
  if (session.status === "awaiting_oauth" || session.status === "pending") {
    return QRCode.toBuffer(`${webBaseUrl()}/bind?token=${session.token}`, {
      width: 520,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#1A3A5C", light: "#FFFFFF" },
    });
  }
  if (session.status === "scanned" && channel.mode === "demo") {
    return QRCode.toBuffer(`${webBaseUrl()}/bind/scan/${session.token}`, {
      width: 520,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#1A3A5C", light: "#FFFFFF" },
    });
  }
  if (
    session.status === "scanned" &&
    channel.mode === "live" &&
    session.qrcode_img?.startsWith("data:image") &&
    session.qrcode_img.includes(",")
  ) {
    return Buffer.from(session.qrcode_img.split(",", 2)[1] ?? "", "base64");
  }
  const payload =
    session.status === "scanned" && channel.mode === "live" && session.qrcode_img
      ? session.qrcode_img
      : session.status === "completed"
        ? `${webBaseUrl()}/bind/success?token=${session.token}`
        : `${webBaseUrl()}/bind?token=${session.token}`;
  if (session.status === "scanned" && channel.mode === "live" && !session.qrcode_img) {
    throw new AppError(409, "QR_NOT_READY", "iLink 二维码尚未生成，请稍后重试。");
  }
  return QRCode.toBuffer(payload, {
    width: 520,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#1A3A5C", light: "#FFFFFF" },
  });
}

export async function simulateScan(token: string) {
  const channel = getDb().prepare("SELECT mode FROM channel_config WHERE id = 1").get() as {
    mode: "demo" | "live";
  };
  if (channel.mode !== "demo") {
    throw new AppError(409, "DEMO_ONLY", "当前为真实通道，不能模拟扫码。");
  }
  const session = getSession(token);
  if (session.status === "completed") return getSessionView(token);
  if (session.status === "expired") {
    throw new AppError(410, "SESSION_EXPIRED", "二维码已过期，请返回后台重新生成。");
  }
  if (session.status !== "scanned" || !session.user_id) {
    throw new AppError(409, "OAUTH_REQUIRED", "请先完成北辰身份授权，再扫描 ClawBot 二维码。");
  }
  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id) as
    | UserRow
    | undefined;
  if (!user?.social_uid) {
    throw new AppError(409, "OAUTH_REQUIRED", "客户身份尚未写入，无法完成 ClawBot 绑定。");
  }
  const now = nowIso();
  const botId = `demo_bot_${crypto
    .createHash("sha256")
    .update(token)
    .digest("hex")
    .slice(0, 16)}`;
  db.prepare(
    `UPDATE users SET ilink_bot_id = ?, clawbot_openid = ?, baseurl = 'demo',
       status = 'bound', is_active = 1, bound_at = ?, last_active_at = ?,
       account_status = 'active', window_expires_at = ?, window_msg_count = 0, updated_at = ?
     WHERE id = ?`,
  ).run(botId, botId, now, now, addHours(now, 24), now, user.id);
  db.prepare(
    `UPDATE binding_sessions SET status = 'completed', poll_status = 'confirmed',
       ilink_bot_id = ?, baseurl = 'demo', completed_at = ?,
       scanned_at = COALESCE(scanned_at, ?) WHERE id = ?`,
  ).run(botId, now, now, session.id);
  emitToAdmins("customer:bound", getUserView(user.id));
  emitToAdmins("binding:updated", { token, status: "completed", userId: user.id });
  return getSessionView(token);
}

export function getSessionView(token: string) {
  const session = getSession(token);
  const db = getDb();
  let userView = null;
  let messages: MessageRow[] = [];
  if (session.user_id) {
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id) as
      | UserRow
      | undefined;
    if (user) userView = getUserView(user.id);
    messages = db
      .prepare("SELECT * FROM messages WHERE user_id = ? ORDER BY sent_at ASC, id ASC")
      .all(session.user_id) as MessageRow[];
  }
  const channel = db.prepare("SELECT mode, customer_qr_url FROM channel_config WHERE id = 1").get() as {
    mode: "demo" | "live";
    customer_qr_url: string | null;
  };
  return {
    token: session.token,
    status: session.status,
    scanStatus: session.poll_status,
    pollError: session.poll_error,
    oauthSent: Boolean(session.oauth_sent),
    ilinkBotId: session.ilink_bot_id,
    mode: channel.mode,
    customerQrUrl: channel.customer_qr_url,
    createdAt: session.created_at,
    expiresAt: session.expires_at,
    scannedAt: session.scanned_at,
    completedAt: session.completed_at,
    oauthUrl: session.oauth_state ? oauthEntryUrl(session.oauth_state) : null,
    user: userView,
    conversation: messages.map((message) => ({
      id: message.id,
      direction: message.direction,
      type: message.msg_type,
      content: message.content,
      mediaUrl: message.media_url,
      sentAt: message.sent_at,
    })),
  };
}

export async function refreshClawbotQr(token: string) {
  const session = getSession(token);
  if (session.status === "completed") return getSessionView(token);
  if (session.status !== "scanned" || !session.user_id) {
    throw new AppError(409, "OAUTH_REQUIRED", "请先完成北辰身份授权。");
  }
  const channel = getDb().prepare("SELECT mode FROM channel_config WHERE id = 1").get() as {
    mode: "demo" | "live";
  };
  stopBindingPoller(token);
  if (channel.mode === "demo") {
    getDb()
      .prepare(
        `UPDATE binding_sessions SET poll_status = 'wait', poll_error = NULL,
           expires_at = ? WHERE id = ?`,
      )
      .run(addMinutes(nowIso(), 10), session.id);
    return getSessionView(token);
  }
  const qr = await getBindingQr();
  const user = getDb()
    .prepare("SELECT social_uid FROM users WHERE id = ?")
    .get(session.user_id) as { social_uid: string | null } | undefined;
  if (user?.social_uid) await setQrMapping(qr.qrcode, user.social_uid);
  getDb()
    .prepare(
      `UPDATE binding_sessions SET qrcode = ?, qrcode_img = ?, poll_baseurl = ?,
         poll_status = 'wait', poll_error = NULL, expires_at = ? WHERE id = ?`,
    )
    .run(qr.qrcode, qr.imageContent, env.ilink.baseUrl, addMinutes(nowIso(), 3), session.id);
  startBindingPoller(token);
  return getSessionView(token);
}

export async function resolveOAuthRedirect(state: string): Promise<string> {
  const session = getDb()
    .prepare("SELECT * FROM binding_sessions WHERE oauth_state = ?")
    .get(state) as BindingSessionRow | undefined;
  if (!session) {
    throw new AppError(400, "INVALID_STATE", "授权链接无效或已过期，请重新扫码。");
  }
  if (session.status === "expired" || isPast(session.expires_at)) {
    throw new AppError(410, "SESSION_EXPIRED", "授权链接已过期，请重新扫码。");
  }
  if (beichenConfigured()) {
    return getLoginUrl(beichenRedirectUri());
  }
  const webBase = webBaseUrl();
  return `${webBase}/mock-oauth?state=${encodeURIComponent(state)}`;
}

export async function completeOAuth(params: {
  state: string;
  code: string;
  loginType?: string;
}) {
  expireStaleSessions();
  const db = getDb();
  const session = db
    .prepare("SELECT * FROM binding_sessions WHERE oauth_state = ?")
    .get(params.state) as BindingSessionRow | undefined;
  if (!session) {
    throw new AppError(400, "INVALID_STATE", "授权链接无效，请重新扫码。");
  }
  if (session.status === "completed" && session.user_id) {
    return { token: session.token, userId: session.user_id };
  }
  if (session.status === "expired" || isPast(session.expires_at)) {
    throw new AppError(410, "SESSION_EXPIRED", "授权已过期，请重新扫码。");
  }
  const loginType = params.loginType || env.beichen.loginType;
  const identity = beichenConfigured()
    ? await exchangeCode(params.code, loginType)
    : mockIdentity(params.state);

  const now = nowIso();
  let user = db
    .prepare("SELECT * FROM users WHERE social_uid = ?")
    .get(identity.social_uid) as UserRow | undefined;
  if (user) {
    gateway.stopUserBot(user.id);
    db.prepare(
      `UPDATE users SET
         login_type = ?, nickname = ?, faceimg = ?, status = 'pending',
         account_status = 'pending_clawbot', is_active = 0,
         info_updated_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      identity.login_type || loginType,
      identity.nickname || user.nickname,
      identity.faceimg || user.faceimg,
      now,
      now,
      user.id,
    );
  } else {
    const info = db
      .prepare(
        `INSERT INTO users
          (clawbot_openid, social_uid, login_type, nickname, faceimg, status, is_active,
           account_status, window_msg_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, 'pending_clawbot', 0, ?, ?)`,
      )
      .run(
        `pending_${identity.social_uid}`,
        identity.social_uid,
        identity.login_type || loginType,
        identity.nickname || "",
        identity.faceimg || null,
        now,
        now,
      );
    user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid) as UserRow;
  }

  const channel = db.prepare("SELECT mode FROM channel_config WHERE id = 1").get() as {
    mode: "demo" | "live";
  };
  db.prepare(
    `UPDATE binding_sessions SET status = 'scanned', user_id = ?, scanned_at = ?,
       expires_at = ?, completed_at = NULL, poll_error = NULL WHERE id = ?`,
  ).run(user.id, now, addMinutes(now, channel.mode === "live" ? 3 : 10), session.id);
  if (channel.mode === "live") {
    try {
      const qr = await getBindingQr();
      await setQrMapping(qr.qrcode, identity.social_uid);
      db.prepare(
        `UPDATE binding_sessions SET qrcode = ?, qrcode_img = ?, poll_baseurl = ?,
           poll_status = 'wait' WHERE id = ?`,
      ).run(qr.qrcode, qr.imageContent, env.ilink.baseUrl, session.id);
      startBindingPoller(session.token);
    } catch (error) {
      db.prepare(
        "UPDATE binding_sessions SET poll_error = ? WHERE id = ?",
      ).run(
        error instanceof Error ? error.message : String(error),
        session.id,
      );
    }
  }
  emitToAdmins("binding:updated", { token: session.token, status: "scanned", userId: user.id });
  return { token: session.token, userId: user.id };
}

export async function refreshUserInfo(user: UserRow) {
  if (user.status !== "bound" || !user.social_uid || !user.login_type) {
    throw new AppError(409, "USER_NOT_BOUND", "客户尚未完成身份授权，无法刷新资料。");
  }
  if (!beichenConfigured()) {
    if (user.social_uid.startsWith("bc_demo_")) {
      getDb()
        .prepare("UPDATE users SET info_updated_at = ?, updated_at = ? WHERE id = ?")
        .run(nowIso(), nowIso(), user.id);
      return getUserView(user.id);
    }
    throw new AppError(503, "ERR_BEICHEN_NOT_CONFIGURED", "北辰聚合登录尚未配置，无法刷新头像昵称。");
  }
  const identity = await queryUser(user.social_uid, user.login_type);
  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE users SET nickname = CASE WHEN ? <> '' THEN ? ELSE nickname END,
         faceimg = CASE WHEN ? <> '' THEN ? ELSE faceimg END,
         info_updated_at = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      identity.nickname,
      identity.nickname,
      identity.faceimg,
      identity.faceimg,
      now,
      now,
      user.id,
    );
  return getUserView(user.id);
}

// ---------------------------------------------------------------------------
// Real iLink QR polling
// ---------------------------------------------------------------------------

const bindingPollers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleBindingPoll(token: string): void {
  const timer = setTimeout(() => {
    bindingPollers.delete(token);
    void pollBindingSession(token);
  }, 1800);
  bindingPollers.set(token, timer);
}

export function startBindingPoller(token: string): void {
  if (bindingPollers.has(token)) return;
  scheduleBindingPoll(token);
}

function stopBindingPoller(token: string): void {
  const timer = bindingPollers.get(token);
  if (timer) clearTimeout(timer);
  bindingPollers.delete(token);
}

export function resumeBindingPollers(): void {
  const rows = getDb()
    .prepare(
      `SELECT token FROM binding_sessions
       WHERE status IN ('pending', 'scanned') AND qrcode IS NOT NULL
         AND expires_at > ?`,
    )
    .all(nowIso()) as Array<{ token: string }>;
  for (const row of rows) startBindingPoller(row.token);
}

async function pollBindingSession(token: string): Promise<void> {
  const db = getDb();
  const session = db
    .prepare("SELECT * FROM binding_sessions WHERE token = ?")
    .get(token) as BindingSessionRow | undefined;
  if (
    !session ||
    !session.qrcode ||
    !["pending", "scanned"].includes(session.status)
  ) {
    stopBindingPoller(token);
    return;
  }
  if (isPast(session.expires_at)) {
    if (session.status === "scanned") {
      db.prepare(
        `UPDATE binding_sessions SET poll_status = 'expired',
           poll_error = '二维码已过期，请刷新', last_poll_at = ? WHERE id = ?`,
      ).run(nowIso(), session.id);
    } else {
      db.prepare(
        `UPDATE binding_sessions SET status = 'expired', poll_status = 'expired',
           last_poll_at = ? WHERE id = ?`,
      ).run(nowIso(), session.id);
    }
    stopBindingPoller(token);
    return;
  }

  let result: BindingQrStatus | null = null;
  try {
    result = await pollBindingQr(session.qrcode, session.poll_baseurl || env.ilink.baseUrl);
  } catch (error) {
    db.prepare(
      "UPDATE binding_sessions SET poll_error = ?, last_poll_at = ? WHERE id = ?",
    ).run(error instanceof Error ? error.message : String(error), nowIso(), session.id);
  }

  if (result) {
    if (result.status === "confirmed") {
      await confirmBinding(session, result);
      return;
    }
    if (result.status === "expired") {
      if (session.status === "scanned") {
        db.prepare(
          `UPDATE binding_sessions SET poll_status = 'expired',
             poll_error = '二维码已过期，请刷新', last_poll_at = ? WHERE id = ?`,
        ).run(nowIso(), session.id);
      } else {
        db.prepare(
          `UPDATE binding_sessions SET status = 'expired', poll_status = 'expired',
             last_poll_at = ? WHERE id = ?`,
        ).run(nowIso(), session.id);
      }
      stopBindingPoller(token);
      return;
    }
    if (result.status === "scaned_but_redirect" && result.redirect_host) {
      const host = result.redirect_host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
      db.prepare(
        `UPDATE binding_sessions SET poll_baseurl = ?, poll_status = 'scanned',
           status = 'scanned', scanned_at = COALESCE(scanned_at, ?), last_poll_at = ?,
           poll_error = NULL, expires_at = ? WHERE id = ?`,
      ).run(
        `https://${host}`,
        nowIso(),
        nowIso(),
        addMinutes(nowIso(), 30),
        session.id,
      );
    } else {
      db.prepare(
        `UPDATE binding_sessions SET poll_status = ?, last_poll_at = ?,
           poll_error = NULL,
           status = CASE WHEN ? = 'scaned' THEN 'scanned' ELSE status END,
           scanned_at = CASE WHEN ? = 'scaned' THEN COALESCE(scanned_at, ?) ELSE scanned_at END,
           expires_at = CASE WHEN ? = 'scaned' THEN ? ELSE expires_at END
         WHERE id = ?`,
      ).run(
        result.status,
        nowIso(),
        result.status,
        result.status,
        nowIso(),
        result.status,
        addMinutes(nowIso(), 30),
        session.id,
      );
    }
  }
  scheduleBindingPoll(token);
}

async function confirmBinding(
  session: BindingSessionRow,
  result: BindingQrStatus,
): Promise<void> {
  const db = getDb();
  if (!session.user_id) {
    db.prepare(
      "UPDATE binding_sessions SET poll_error = ?, last_poll_at = ? WHERE id = ?",
    ).run("请先完成北辰身份授权，再扫描 ClawBot 二维码。", nowIso(), session.id);
    stopBindingPoller(session.token);
    return;
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id) as
    | UserRow
    | undefined;
  if (!user?.social_uid) {
    db.prepare(
      "UPDATE binding_sessions SET poll_error = ?, last_poll_at = ? WHERE id = ?",
    ).run("客户身份尚未写入，无法激活 ClawBot 绑定。", nowIso(), session.id);
    stopBindingPoller(session.token);
    return;
  }
  const mappedSocialUid = await getQrMapping(session.qrcode ?? "");
  if (mappedSocialUid && mappedSocialUid !== user.social_uid) {
    db.prepare(
      "UPDATE binding_sessions SET poll_error = ?, last_poll_at = ? WHERE id = ?",
    ).run("二维码与当前客户身份不匹配，请重新扫码。", nowIso(), session.id);
    stopBindingPoller(session.token);
    return;
  }
  if (!result.ilink_bot_id || !result.bot_token) {
    db.prepare(
      "UPDATE binding_sessions SET poll_error = ?, last_poll_at = ? WHERE id = ?",
    ).run("扫码已确认，但 iLink 未返回 ilink_bot_id 或 bot_token。", nowIso(), session.id);
    stopBindingPoller(session.token);
    return;
  }
  const now = nowIso();
  const baseurl = result.baseurl || session.poll_baseurl || env.ilink.baseUrl;
  const encryptedToken = encryptSecret(result.bot_token);
  const conflict = db
    .prepare("SELECT id FROM users WHERE ilink_bot_id = ? AND id <> ?")
    .get(result.ilink_bot_id, user.id) as { id: number } | undefined;
  if (conflict) {
    db.prepare(
      "UPDATE binding_sessions SET poll_error = ?, last_poll_at = ? WHERE id = ?",
    ).run("该 ilink_bot_id 已绑定其他客户，请联系客服处理。", now, session.id);
    stopBindingPoller(session.token);
    return;
  }

  db.prepare(
    `UPDATE users SET
       ilink_bot_id = ?, clawbot_openid = ?, baseurl = ?, bot_token = ?,
       ilink_user_id = ?, status = 'bound', is_active = 1,
       account_status = 'active', bound_at = ?, last_active_at = ?, window_expires_at = ?,
       window_msg_count = 0, context_token = NULL, updated_at = ?
     WHERE id = ?`,
  ).run(
    result.ilink_bot_id,
    result.ilink_bot_id,
    baseurl,
    encryptedToken,
    result.ilink_user_id ?? null,
    now,
    now,
    addHours(now, 24),
    now,
    user.id,
  );
  db.prepare(
    `UPDATE binding_sessions SET
       status = 'completed', poll_status = 'confirmed',
       ilink_bot_id = ?, baseurl = ?, bot_token = ?, ilink_user_id = ?,
       completed_at = ?, last_poll_at = ?
     WHERE id = ?`,
  ).run(
    result.ilink_bot_id,
    baseurl,
    encryptedToken,
    result.ilink_user_id ?? null,
    now,
    now,
    session.id,
  );
  stopBindingPoller(session.token);
  await deleteQrMapping(session.qrcode);
  const bound = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id) as UserRow;
  await gateway.startUserBot(bound);
  emitToAdmins("customer:bound", getUserView(bound.id));
  emitToAdmins("binding:updated", { token: session.token, status: "completed", userId: user.id });
}
