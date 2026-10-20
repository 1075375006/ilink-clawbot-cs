import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import path from "node:path";
import { getDb, type UserRow } from "../db.js";
import { AppError } from "../errors.js";
import { emitToAdmins } from "../realtime.js";
import { isWindowOpen, nowIso } from "../util/time.js";
import { renderKeepaliveTemplate } from "./keepalive.js";
import { sendOutbound } from "./messages.js";
import { getUserView } from "./users.js";

export interface KeepaliveScheduleRow {
  id: number;
  cron_expr: string;
  message: string;
  media_type: string;
  media_url: string | null;
  media_name: string | null;
  enabled: number;
  only_if_active: number;
  created_at: string;
  updated_at: string;
}

export interface ScheduleInput {
  cronExpr: string;
  message: string;
  mediaType?: "text" | "image" | "file";
  mediaUrl?: string | null;
  mediaName?: string | null;
  enabled?: boolean;
  onlyIfActive?: boolean;
}

const tasks = new Map<number, ScheduledTask>();

export function listSchedules(): KeepaliveScheduleRow[] {
  return getDb()
    .prepare("SELECT * FROM keepalive_schedules ORDER BY id DESC")
    .all() as KeepaliveScheduleRow[];
}

function validate(input: ScheduleInput): void {
  if (!cron.validate(input.cronExpr)) {
    throw new AppError(400, "INVALID_CRON", "定时表达式不是有效的 5 字段 cron。");
  }
  if (!input.message.trim() || input.message.length > 500) {
    throw new AppError(400, "INVALID_SCHEDULE_MESSAGE", "定时保活文案需为 1–500 字。");
  }
  if ((input.mediaType === "image" || input.mediaType === "file") && !input.mediaUrl) {
    throw new AppError(400, "MEDIA_REQUIRED", "媒体定时保活需要先上传文件。");
  }
}

export function createSchedule(input: ScheduleInput): KeepaliveScheduleRow {
  validate(input);
  const at = nowIso();
  const info = getDb()
    .prepare(
      `INSERT INTO keepalive_schedules
        (cron_expr, message, media_type, media_url, media_name, enabled, only_if_active,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.cronExpr,
      input.message.trim(),
      input.mediaType ?? "text",
      input.mediaUrl ?? null,
      input.mediaName ?? null,
      input.enabled === false ? 0 : 1,
      input.onlyIfActive === false ? 0 : 1,
      at,
      at,
    );
  reloadScheduledKeepalives();
  return getDb()
    .prepare("SELECT * FROM keepalive_schedules WHERE id = ?")
    .get(info.lastInsertRowid) as KeepaliveScheduleRow;
}

export function updateSchedule(id: number, input: Partial<ScheduleInput>): KeepaliveScheduleRow {
  const current = getDb()
    .prepare("SELECT * FROM keepalive_schedules WHERE id = ?")
    .get(id) as KeepaliveScheduleRow | undefined;
  if (!current) throw new AppError(404, "SCHEDULE_NOT_FOUND", "定时保活任务不存在。");
  const merged: ScheduleInput = {
    cronExpr: input.cronExpr ?? current.cron_expr,
    message: input.message ?? current.message,
    mediaType: (input.mediaType ?? current.media_type) as "text" | "image" | "file",
    mediaUrl: input.mediaUrl !== undefined ? input.mediaUrl : current.media_url,
    mediaName: input.mediaName !== undefined ? input.mediaName : current.media_name,
    enabled: input.enabled ?? Boolean(current.enabled),
    onlyIfActive: input.onlyIfActive ?? Boolean(current.only_if_active),
  };
  validate(merged);
  getDb()
    .prepare(
      `UPDATE keepalive_schedules SET cron_expr = ?, message = ?, media_type = ?,
         media_url = ?, media_name = ?, enabled = ?, only_if_active = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      merged.cronExpr,
      merged.message.trim(),
      merged.mediaType ?? "text",
      merged.mediaUrl ?? null,
      merged.mediaName ?? null,
      merged.enabled ? 1 : 0,
      merged.onlyIfActive ? 1 : 0,
      nowIso(),
      id,
    );
  reloadScheduledKeepalives();
  return getDb()
    .prepare("SELECT * FROM keepalive_schedules WHERE id = ?")
    .get(id) as KeepaliveScheduleRow;
}

export function deleteSchedule(id: number): void {
  getDb().prepare("DELETE FROM keepalive_schedules WHERE id = ?").run(id);
  reloadScheduledKeepalives();
}

export function recentScheduleRuns(limit = 10) {
  return getDb()
    .prepare(
      `SELECT r.*, s.cron_expr FROM keepalive_runs r
       LEFT JOIN keepalive_schedules s ON s.id = r.schedule_id
       ORDER BY r.triggered_at DESC LIMIT ?`,
    )
    .all(limit);
}

export async function runScheduledKeepalive(
  schedule: KeepaliveScheduleRow,
  now = new Date(),
): Promise<{ sent: number; skipped: number }> {
  const db = getDb();
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const users = db
    .prepare(
      `SELECT * FROM users
       WHERE status = 'bound' AND COALESCE(account_status, 'active') = 'active'
         AND last_active_at IS NOT NULL AND last_active_at > ? AND window_msg_count < 10`,
    )
    .all(cutoff) as UserRow[];
  let sent = 0;
  let skipped = 0;
  for (const user of users) {
    if (schedule.only_if_active && !isWindowOpen(user.last_active_at, now)) {
      skipped += 1;
      continue;
    }
    const content = renderKeepaliveTemplate(schedule.message, getUserView(user.id).name);
    try {
      await sendOutbound(user.id, {
        content,
        msgType:
          schedule.media_type === "image"
            ? "image"
            : schedule.media_type === "file"
              ? "file"
              : "text",
        mediaUrl: schedule.media_url,
        mediaName:
          schedule.media_name ??
          (schedule.media_type === "file" && schedule.media_url
            ? path.basename(schedule.media_url)
            : null),
        isKeepalive: true,
      });
      sent += 1;
      db.prepare(
        "INSERT INTO keepalive_logs (user_id, status, reason, sent_at) VALUES (?, 'sent', ?, ?)",
      ).run(user.id, `schedule:${schedule.id}`, nowIso());
    } catch {
      skipped += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  db.prepare(
    `INSERT INTO keepalive_runs (schedule_id, triggered_at, sent_count, skip_count)
     VALUES (?, ?, ?, ?)`,
  ).run(schedule.id, nowIso(), sent, skipped);
  emitToAdmins("keepalive:run", { scheduleId: schedule.id, sent, skipped });
  return { sent, skipped };
}

export function reloadScheduledKeepalives(): void {
  tasks.forEach((task) => task.stop());
  tasks.clear();
  for (const schedule of listSchedules()) {
    if (!schedule.enabled || !cron.validate(schedule.cron_expr)) continue;
    const task = cron.schedule(schedule.cron_expr, () => {
      void runScheduledKeepalive(schedule).catch((error: unknown) => {
        console.error("[keepalive] scheduled run failed:", error);
      });
    });
    tasks.set(schedule.id, task);
  }
}
