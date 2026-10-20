import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { getDb, type ChannelRow } from "../db.js";
import { env } from "../env.js";
import { AppError } from "../errors.js";
import { gateway } from "../ilink/gateway.js";
import { emitToAdmins } from "../realtime.js";
import { nowIso } from "../util/time.js";

export function channelRow(): ChannelRow {
  return getDb().prepare("SELECT * FROM channel_config WHERE id = 1").get() as ChannelRow;
}

export function channelStatus() {
  const row = channelRow();
  return {
    ...gateway.status(),
    customerQrUrl: row.customer_qr_url,
    configuredMode: row.mode,
    beichenConfigured: Boolean(env.beichen.appid && env.beichen.appkey),
    publicBaseUrl: env.publicBaseUrl,
    protocol: "iLink Long Polling",
  };
}

function emitStatus() {
  const status = channelStatus();
  emitToAdmins("channel:status", status);
  return status;
}

export function setCustomerQr(url: string | null) {
  let value: string | null = null;
  if (url) {
    if (!url.startsWith("/uploads/")) {
      throw new AppError(400, "INVALID_QR_URL", "客户扫码二维码必须是本系统上传的图片。");
    }
    const absolute = path.resolve(env.uploadDir, url.replace(/^\/uploads\//, ""));
    if (!absolute.startsWith(path.resolve(env.uploadDir)) || !fs.existsSync(absolute)) {
      throw new AppError(400, "INVALID_QR_URL", "二维码图片不存在，请重新上传。");
    }
    value = url;
  }
  getDb()
    .prepare("UPDATE channel_config SET customer_qr_url = ?, updated_at = ? WHERE id = 1")
    .run(value, nowIso());
  return emitStatus();
}

export function switchMode(mode: "demo" | "live") {
  const db = getDb();
  if (mode === "demo") {
    gateway.stop();
    db.prepare(
      `UPDATE channel_config SET mode = 'demo', connected_at = ?, bot_token = NULL,
         bot_id = NULL, base_url = NULL, cursor = NULL, updated_at = ? WHERE id = 1`,
    ).run(nowIso(), nowIso());
  } else {
    db.prepare(
      `UPDATE channel_config SET mode = 'live',
         connected_at = CASE WHEN bot_token IS NOT NULL THEN connected_at ELSE NULL END,
         updated_at = ? WHERE id = 1`,
    ).run(nowIso());
    void gateway.start();
    void gateway.startAllUserBots();
  }
  return emitStatus();
}

export async function startLogin() {
  const result = await gateway.beginLogin();
  const dataUrl = await QRCode.toDataURL(result.imageContent, {
    width: 560,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#1A3A5C", light: "#FFFFFF" },
  });
  return { loginId: result.id, qrDataUrl: dataUrl, expiresInSeconds: 480 };
}

export async function pollLogin(id: string) {
  if (!id || id.length > 4096) {
    throw new AppError(400, "INVALID_LOGIN_ID", "登录标识无效。");
  }
  const result = await gateway.pollLogin(id);
  return { ...result, channel: channelStatus() };
}

export function disconnect() {
  gateway.stop();
  getDb()
    .prepare(
      `UPDATE channel_config SET connected_at = NULL, bot_token = NULL, bot_id = NULL,
         cursor = NULL, updated_at = ? WHERE id = 1`,
    )
    .run(nowIso());
  return emitStatus();
}
