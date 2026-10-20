import fs from "node:fs";
import path from "node:path";
import { getDb, type MessageRow, type UserRow } from "../db.js";
import { env } from "../env.js";
import { AppError, notFound } from "../errors.js";
import { emitToAdmins } from "../realtime.js";
import { serializeMessage } from "../serializers.js";
import { gateway, type InboundEvent } from "../ilink/gateway.js";
import { IlinkQuotaExhaustedError, IlinkSessionExpiredError } from "../ilink/api.js";
import { contextTokenKey, redisSetEx } from "../redis.js";
import {
  countReplyUsed,
  getBoundUser,
  getUserById,
  getUserView,
  replyQuotaPerWindow,
} from "./users.js";
import { addHours, isWindowOpen, windowRemainingSeconds } from "../util/time.js";

export interface OutboundInput {
  content: string;
  msgType?: "text" | "image" | "file" | "template" | "system";
  mediaUrl?: string | null;
  mediaName?: string | null;
  mediaSize?: number | null;
  mediaMime?: string | null;
  isKeepalive?: boolean;
  allowPending?: boolean;
  skipQuota?: boolean;
}

export function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function splitTextByBytes(value: string, maxBytes = 16_384): string[] {
  if (utf8Bytes(value) <= maxBytes) return [value];
  const chunks: string[] = [];
  let current = "";
  let size = 0;
  for (const char of value) {
    const bytes = Buffer.byteLength(char, "utf8");
    if (size + bytes > maxBytes && current) {
      chunks.push(current);
      current = char;
      size = bytes;
    } else {
      current += char;
      size += bytes;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [value];
}

let insertCounter = 0;

export function pruneMessages(now = new Date()): { removedExpired: number; removedOverflow: number } {
  const db = getDb();
  const cutoff = new Date(
    now.getTime() - env.messageRetentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const expired = db.prepare("DELETE FROM messages WHERE sent_at < ?").run(cutoff);
  let overflow = { changes: 0 };
  const count = (db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n;
  if (count > env.messageMaxCount) {
    overflow = db
      .prepare(
        `DELETE FROM messages WHERE id IN (
           SELECT id FROM messages ORDER BY sent_at ASC, id ASC LIMIT ?
         )`,
      )
      .run(count - env.messageMaxCount);
  }
  return { removedExpired: expired.changes, removedOverflow: overflow.changes };
}

function maybePruneMessages(): void {
  insertCounter += 1;
  if (insertCounter % 100 === 0) pruneMessages();
}

export function insertInbound(userId: number, event: InboundEvent): MessageRow | null {
  const db = getDb();
  if (event.messageId || event.ilinkMsgId) {
    const duplicate = event.messageId
      ? db.prepare("SELECT id FROM messages WHERE message_id = ?").get(event.messageId)
      : db.prepare("SELECT id FROM messages WHERE ilink_msg_id = ?").get(event.ilinkMsgId);
    if (duplicate) return null;
  }
  const now = new Date().toISOString();
  const at = event.at || now;
  const images = event.images ?? [];
  const files = event.files ?? [];
  const text = event.text.trim();

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE users SET
         last_active_at = ?, window_expires_at = ?, context_token = ?,
         reply_count = 0, reply_window_started_at = ?, window_msg_count = 0,
         updated_at = ?
       WHERE id = ?`,
    ).run(at, addHours(at, 24), event.contextToken, at, now, userId);

    if (event.contextToken) {
      const user = db
        .prepare("SELECT ilink_bot_id, ilink_user_id FROM users WHERE id = ?")
        .get(userId) as { ilink_bot_id: string | null; ilink_user_id: string | null } | undefined;
      if (user?.ilink_bot_id) {
        const targets = new Set([event.openid, user.ilink_user_id].filter(Boolean) as string[]);
        for (const target of targets) {
          void redisSetEx(
            contextTokenKey(user.ilink_bot_id, target),
            event.contextToken,
            86_400,
          );
        }
      }
    }

    const items: Array<{
      type: "text" | "image" | "file";
      content: string;
      media: string | null;
      mediaName?: string | null;
      mediaSize?: number | null;
      mediaMime?: string | null;
    }> = [];
    images.forEach((image, index) => {
      items.push({
        type: "image",
        content: index === 0 && text ? text : "图片",
        media: image.url,
        mediaName: "图片",
        mediaMime: null,
      });
    });
    files.forEach((file, index) => {
      items.push({
        type: "file",
        content: index === 0 && text ? text : file.name,
        media: file.url,
        mediaName: file.name,
        mediaSize: file.size,
        mediaMime: file.mime,
      });
    });
    if (!items.length) {
      items.push({ type: "text", content: text, media: null });
    }

    const inserted: MessageRow[] = [];
    items.forEach((item, index) => {
      const info = db
        .prepare(
          `INSERT INTO messages
            (user_id, direction, msg_type, content, media_url, media_name, media_size,
             media_mime, message_id, ilink_msg_id,
             content_json, is_keepalive, is_read, consumed_quota, delivery_status, sent_at)
           VALUES (?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'delivered', ?)`,
        )
        .run(
          userId,
          item.type,
          item.content,
          item.media,
          item.mediaName ?? null,
          item.mediaSize ?? null,
          item.mediaMime ?? null,
          event.messageId ? `${event.messageId}${index ? `_${index}` : ""}` : null,
          event.ilinkMsgId ? `${event.ilinkMsgId}${index ? `_${index}` : ""}` : null,
          JSON.stringify({
            text: item.content,
            type: item.type,
            mediaUrl: item.media,
            mediaName: item.mediaName ?? null,
            mediaSize: item.mediaSize ?? null,
            mediaMime: item.mediaMime ?? null,
            clientId: event.clientId,
          }),
          at,
        );
      inserted.push(
        db.prepare("SELECT * FROM messages WHERE id = ?").get(info.lastInsertRowid) as MessageRow,
      );
    });
    return inserted;
  });

  const rows = tx();
  if (rows.length) maybePruneMessages();
  return rows[0] ?? null;
}

export async function handleInbound(event: InboundEvent): Promise<void> {
  const db = getDb();
  const user = db
    .prepare("SELECT * FROM users WHERE clawbot_openid = ?")
    .get(event.openid) as UserRow | undefined;
  if (!user || user.status !== "bound") return;

  const message = insertInbound(user.id, event);
  if (!message) return;
  const fresh = getUserById(user.id);
  emitToAdmins("message:new", {
    userId: fresh.id,
    message: serializeMessage(message),
    user: getUserView(fresh.id),
  });
  emitToAdmins("conversation:updated", {
    userId: fresh.id,
    user: getUserView(fresh.id),
  });
}

export async function handleInboundForUser(
  userId: number,
  event: InboundEvent,
): Promise<void> {
  const user = getDb().prepare("SELECT * FROM users WHERE id = ?").get(userId) as
    | UserRow
    | undefined;
  if (!user || user.status === "unbound") return;
  if (user.status !== "bound") return;
  const message = insertInbound(user.id, event);
  if (!message) return;
  const fresh = getUserById(user.id);
  emitToAdmins("message:new", {
    userId: fresh.id,
    message: serializeMessage(message),
    user: getUserView(fresh.id),
  });
  emitToAdmins("conversation:updated", {
    userId: fresh.id,
    user: getUserView(fresh.id),
  });
}

export function listMessages(userId: number, beforeId?: number, limit = 30) {
  const user = getUserById(userId);
  const safeLimit = Math.min(100, Math.max(1, limit));
  const rows = (
    beforeId
      ? getDb()
          .prepare(
            `SELECT * FROM messages WHERE user_id = ? AND id < ?
             ORDER BY sent_at DESC, id DESC LIMIT ?`,
          )
          .all(user.id, beforeId, safeLimit + 1)
      : getDb()
          .prepare(
            `SELECT * FROM messages WHERE user_id = ?
             ORDER BY sent_at DESC, id DESC LIMIT ?`,
          )
          .all(user.id, safeLimit + 1)
  ) as MessageRow[];
  const hasMore = rows.length > safeLimit;
  const page = rows.slice(0, safeLimit).reverse();
  return {
    items: page.map(serializeMessage),
    hasMore,
    nextBeforeId: hasMore && page.length ? page[0]!.id : null,
  };
}

function resolveMediaPath(url: string): string {
  if (!url.startsWith("/uploads/")) {
    throw new AppError(400, "INVALID_MEDIA", "媒体地址无效。");
  }
  const relative = url.replace(/^\/uploads\//, "");
  const absolute = path.resolve(env.uploadDir, relative);
  if (!absolute.startsWith(path.resolve(env.uploadDir))) {
    throw new AppError(400, "INVALID_MEDIA", "媒体地址无效。");
  }
  if (!fs.existsSync(absolute)) {
    throw new AppError(400, "INVALID_MEDIA", "媒体文件不存在，请重新上传。");
  }
  return absolute;
}

export async function sendOutbound(
  userId: number,
  input: OutboundInput,
): Promise<MessageRow> {
  const user = getUserById(userId);
  if (!input.allowPending && user.status !== "bound") {
    throw new AppError(409, "USER_NOT_BOUND", "该客户尚未完成身份绑定。");
  }
  if (user.status === "unbound") {
    throw new AppError(409, "USER_UNBOUND", "该客户已解绑 ClawBot。");
  }
  const msgType = input.msgType ?? "text";
  const content =
    input.content.trim() || (msgType === "file" ? input.mediaName ?? "文件" : "");
  if (msgType !== "image" && msgType !== "file" && !content) {
    throw new AppError(400, "EMPTY_MESSAGE", "消息内容不能为空。");
  }
  if ((msgType === "image" || msgType === "file") && !input.mediaUrl) {
    throw new AppError(400, "MEDIA_REQUIRED", "请先上传媒体文件。");
  }
  if (user.account_status === "session_expired") {
    throw new AppError(400, "ERR_BOT_INVALID", "ClawBot 登录已失效，请客户重新扫码绑定。");
  }

  if (user.status === "bound" && !isWindowOpen(user.last_active_at)) {
    throw new AppError(
      400,
      "ERR_WINDOW_EXPIRED",
      "对话窗口已关闭，等待客户主动发言后才能发送消息。",
    );
  }
  const segments =
    msgType === "image" || msgType === "file"
      ? [content]
      : splitTextByBytes(content, 16_384);
  if (msgType === "image" && utf8Bytes(content) > 16_384) {
    throw new AppError(400, "MESSAGE_TOO_LONG", "图片说明不能超过 16384 字节。");
  }
  const used = user.window_msg_count;
  const quota = replyQuotaPerWindow();
  const remaining = Math.max(0, quota - used);
  if (!input.skipQuota && segments.length > remaining) {
    throw new AppError(
      400,
      "ERR_QUOTA_EXCEEDED",
      `本条消息需要 ${segments.length} 条配额，当前仅剩 ${remaining} 条。`,
    );
  }

  const db = getDb();
  let lastRow: MessageRow | null = null;

  const insertOutbound = (params: {
    content: string;
    clientId: string | null;
    status: "sent" | "failed";
    error: string | null;
  }) => {
    const now = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO messages
          (user_id, direction, msg_type, content, media_url, media_name, media_size,
           media_mime, message_id, client_id, content_json, is_keepalive, is_read,
           consumed_quota, delivery_status, error, sent_at)
         VALUES (?, 'outbound', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 1, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        msgType,
        params.content,
        input.mediaUrl ?? null,
        input.mediaName ?? null,
        input.mediaSize ?? null,
        input.mediaMime ?? null,
        params.clientId,
        JSON.stringify({
          text: params.content,
          mediaUrl: input.mediaUrl ?? null,
          mediaName: input.mediaName ?? null,
          mediaMime: input.mediaMime ?? null,
          clientId: params.clientId,
        }),
        input.isKeepalive ? 1 : 0,
        params.status === "sent" ? 1 : 0,
        params.status,
        params.error,
        now,
      );
    return db.prepare("SELECT * FROM messages WHERE id = ?").get(info.lastInsertRowid) as MessageRow;
  };

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    let clientId: string | null = null;
    try {
      if (msgType === "file" && input.mediaUrl) {
        const filePath = resolveMediaPath(input.mediaUrl);
        clientId = await gateway.sendFile(
          getUserById(userId),
          filePath,
          input.mediaName ?? "file",
          content && content !== input.mediaName ? content : undefined,
        );
      } else if (msgType === "image" && input.mediaUrl) {
        const filePath = resolveMediaPath(input.mediaUrl);
        clientId = await gateway.sendImage(getUserById(userId), filePath, content || undefined);
      } else {
        clientId = await gateway.sendText(getUserById(userId), segment);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      const failed = insertOutbound({ content: segment, clientId, status: "failed", error: message });
      emitToAdmins("message:new", { userId, message: serializeMessage(failed) });
      if (caught instanceof IlinkSessionExpiredError) {
        db.prepare(
          `UPDATE users SET is_active = 0, account_status = 'session_expired',
             updated_at = ? WHERE id = ?`,
        ).run(new Date().toISOString(), userId);
        gateway.stopUserBot(userId);
        throw new AppError(400, "ERR_BOT_INVALID", "ClawBot 登录已失效，请客户重新扫码绑定。");
      }
      if (caught instanceof IlinkQuotaExhaustedError) {
        db.prepare("UPDATE users SET window_msg_count = 10, updated_at = ? WHERE id = ?").run(
          new Date().toISOString(),
          userId,
        );
        throw new AppError(400, "ERR_QUOTA_EXCEEDED", "本轮 10 条配额已耗尽，等待客户回复。");
      }
      throw new AppError(502, "ERR_SEND_FAILED", message || "消息发送失败，请稍后重试。");
    }

    const row = insertOutbound({
      content: segment,
      clientId,
      status: "sent",
      error: null,
    });
    db.prepare(
      "UPDATE users SET window_msg_count = MIN(10, window_msg_count + 1), updated_at = ? WHERE id = ?",
    ).run(new Date().toISOString(), userId);
    const fresh = getUserById(userId);
    emitToAdmins("message:new", {
      userId,
      message: serializeMessage(row),
      user: fresh.status === "bound" ? getUserView(userId) : undefined,
    });
    lastRow = row;
  }
  maybePruneMessages();
  if (!lastRow) throw new AppError(400, "EMPTY_MESSAGE", "消息内容不能为空。");
  return lastRow;
}

export function assertCanSend(userId: number): UserRow {
  const user = getBoundUser(userId);
  if (!isWindowOpen(user.last_active_at)) {
    throw new AppError(
      400,
      "ERR_WINDOW_EXPIRED",
      "对话窗口已关闭，等待客户主动发言后才能发送消息。",
    );
  }
  if (countReplyUsed(userId) >= replyQuotaPerWindow()) {
    throw new AppError(400, "ERR_QUOTA_EXCEEDED", "本对话窗口的回复额度已用完。");
  }
  return user;
}

export function windowInfo(user: UserRow) {
  return {
    open: isWindowOpen(user.last_active_at),
    remainingSeconds: windowRemainingSeconds(user.last_active_at),
    replyUsed: user.window_msg_count,
    replyQuota: replyQuotaPerWindow(),
  };
}

export function getMessage(id: number): MessageRow {
  const row = getDb().prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
  if (!row) throw notFound("消息不存在");
  return row;
}
