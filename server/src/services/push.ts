import { getDb } from "../db.js";
import { AppError } from "../errors.js";
import { sendOutbound } from "./messages.js";
import { countReplyUsed, getUserById, replyQuotaPerWindow } from "./users.js";
import { isWindowOpen, nowIso } from "../util/time.js";

export interface PushInput {
  userIds: number[];
  content: string;
  msgType?: "text" | "image" | "file";
  mediaUrl?: string | null;
  mediaName?: string | null;
  mediaSize?: number | null;
  mediaMime?: string | null;
}

export function previewPush(userIds: number[]) {
  const ids = [...new Set(userIds)].filter((id) => Number.isInteger(id));
  const selected = ids.map((id) => {
    try {
      const user = getUserById(id);
      let reason = "";
      if (user.status !== "bound") reason = "尚未完成身份绑定";
      else if (user.account_status === "session_expired") reason = "ClawBot 登录已失效";
      else if (!isWindowOpen(user.last_active_at)) reason = "对话窗口已关闭";
      else if (countReplyUsed(user.id) >= replyQuotaPerWindow()) reason = "本窗口回复额度已用完";
      return {
        userId: user.id,
        name: user.remark || user.nickname || user.clawbot_openid.slice(0, 8),
        avatar: user.faceimg,
        reachable: !reason,
        reason,
      };
    } catch {
      return {
        userId: id,
        name: `客户 #${id}`,
        avatar: null,
        reachable: false,
        reason: "客户不存在",
      };
    }
  });
  return {
    selected: selected.length,
    reachable: selected.filter((item) => item.reachable).length,
    unreachable: selected.filter((item) => !item.reachable).length,
    items: selected,
  };
}

export async function sendPush(input: PushInput) {
  const ids = [...new Set(input.userIds)];
  if (!ids.length) throw new AppError(400, "NO_RECIPIENTS", "请至少选择一位客户。");
  const content = input.content.trim();
  const msgType = input.msgType ?? "text";
  if (msgType === "text" && !content) {
    throw new AppError(400, "EMPTY_MESSAGE", "推送内容不能为空。");
  }
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > 100_000) {
    throw new AppError(400, "MESSAGE_TOO_LONG", "推送内容过长，请控制在 100KB 以内。");
  }
  if ((msgType === "image" || msgType === "file") && !input.mediaUrl) {
    throw new AppError(400, "MEDIA_REQUIRED", "请先上传媒体文件。");
  }
  const preview = previewPush(ids);
  const db = getDb();
  const campaign = db
    .prepare(
      `INSERT INTO push_campaigns (content, msg_type, total, sent, failed, skipped, created_at)
       VALUES (?, ?, ?, 0, 0, 0, ?)`,
    )
    .run(content, msgType, ids.length, nowIso());
  const campaignId = Number(campaign.lastInsertRowid);
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const results: Array<{
    userId: number;
    name: string;
    status: "sent" | "failed" | "skipped";
    reason?: string;
  }> = [];

  for (const item of preview.items) {
    if (!item.reachable) {
      skipped += 1;
      results.push({ userId: item.userId, name: item.name, status: "skipped", reason: item.reason });
      db.prepare(
        "INSERT INTO push_recipients (campaign_id, user_id, status, error, sent_at) VALUES (?, ?, 'skipped', ?, ?)",
      ).run(campaignId, item.userId, item.reason, nowIso());
      continue;
    }
    try {
      await sendOutbound(item.userId, {
        content,
        msgType,
        mediaUrl: input.mediaUrl,
        mediaName: input.mediaName,
        mediaSize: input.mediaSize,
        mediaMime: input.mediaMime,
      });
      sent += 1;
      results.push({ userId: item.userId, name: item.name, status: "sent" });
      db.prepare(
        "INSERT INTO push_recipients (campaign_id, user_id, status, error, sent_at) VALUES (?, ?, 'sent', NULL, ?)",
      ).run(campaignId, item.userId, nowIso());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed += 1;
      results.push({ userId: item.userId, name: item.name, status: "failed", reason: message });
      db.prepare(
        "INSERT INTO push_recipients (campaign_id, user_id, status, error, sent_at) VALUES (?, ?, 'failed', ?, ?)",
      ).run(campaignId, item.userId, message, nowIso());
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  db.prepare(
    "UPDATE push_campaigns SET sent = ?, failed = ?, skipped = ? WHERE id = ?",
  ).run(sent, failed, skipped, campaignId);
  return {
    campaignId,
    total: ids.length,
    sent,
    failed,
    skipped,
    results,
  };
}

export function pushHistory(limit = 10) {
  const rows = getDb()
    .prepare("SELECT * FROM push_campaigns ORDER BY created_at DESC LIMIT ?")
    .all(limit) as Array<{
    id: number;
    content: string;
    msg_type: string;
    total: number;
    sent: number;
    failed: number;
    skipped: number;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    msgType: row.msg_type,
    total: row.total,
    sent: row.sent,
    failed: row.failed,
    skipped: row.skipped,
    createdAt: row.created_at,
  }));
}
