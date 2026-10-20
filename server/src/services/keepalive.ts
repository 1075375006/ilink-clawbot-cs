import { getDb, type KeepaliveConfigRow, type UserRow } from "../db.js";
import { emitToAdmins } from "../realtime.js";
import { countReplyUsed, getUserView, replyQuotaPerWindow } from "./users.js";
import { sendOutbound } from "./messages.js";
import {
  HOUR_MS,
  dateKey,
  isSilentNow,
  isWindowOpen,
  nowIso,
  startOfShanghaiDayIso,
} from "../util/time.js";
import { AppError } from "../errors.js";

export function getKeepaliveConfig(): KeepaliveConfigRow {
  return getDb().prepare("SELECT * FROM keepalive_config WHERE id = 1").get() as KeepaliveConfigRow;
}

export interface KeepaliveInput {
  enabled: boolean;
  thresholdHours: number;
  msgTemplate: string;
  maxPerDay: number;
  quotaWarnAt: number;
  silentStart: string;
  silentEnd: string;
}

const URL_PATTERN = /(https?:\/\/|www\.)/i;

export function validateKeepaliveInput(input: KeepaliveInput): void {
  if (!Number.isInteger(input.thresholdHours) || input.thresholdHours < 1 || input.thresholdHours > 23) {
    throw new AppError(400, "INVALID_THRESHOLD", "保活阈值需在 1–23 小时之间。");
  }
  if (!Number.isInteger(input.maxPerDay) || input.maxPerDay < 1 || input.maxPerDay > 5) {
    throw new AppError(400, "INVALID_MAX_PER_DAY", "每日最大次数需在 1–5 之间。");
  }
  if (!Number.isInteger(input.quotaWarnAt) || input.quotaWarnAt < 1 || input.quotaWarnAt > 3) {
    throw new AppError(400, "INVALID_QUOTA_WARN", "配额预警触发需在 1–3 条之间。");
  }
  const template = input.msgTemplate.trim();
  if (!template || template.length > 500) {
    throw new AppError(400, "INVALID_TEMPLATE", "保活文案需为 1–500 字。");
  }
  if (URL_PATTERN.test(template)) {
    throw new AppError(400, "TEMPLATE_LINK", "保活文案不能包含外部链接，避免触发平台审核。");
  }
  if (!/^\d{2}:\d{2}$/.test(input.silentStart) || !/^\d{2}:\d{2}$/.test(input.silentEnd)) {
    throw new AppError(400, "INVALID_SILENT_TIME", "静默时段格式应为 HH:mm。");
  }
}

export function updateKeepaliveConfig(input: KeepaliveInput): KeepaliveConfigRow {
  validateKeepaliveInput(input);
  getDb()
    .prepare(
      `UPDATE keepalive_config SET
         enabled = ?, threshold_hours = ?, msg_template = ?, max_per_day = ?,
         quota_warn_at = ?, silent_start = ?, silent_end = ?, updated_at = ?
       WHERE id = 1`,
    )
    .run(
      input.enabled ? 1 : 0,
      input.thresholdHours,
      input.msgTemplate.trim(),
      input.maxPerDay,
      input.quotaWarnAt,
      input.silentStart,
      input.silentEnd,
      nowIso(),
    );
  const config = getKeepaliveConfig();
  emitToAdmins("keepalive:updated", config);
  return config;
}

export function renderKeepaliveTemplate(
  template: string,
  name: string | null,
): string {
  const safeName = (name ?? "").trim();
  return template
    .replaceAll("{nickname}", safeName)
    .replaceAll("{nickname_suffix}", safeName ? `，${safeName}` : "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export type CandidateReason =
  | "eligible"
  | "window_closed"
  | "not_due"
  | "daily_limit"
  | "already_sent"
  | "quota"
  | "quota_full"
  | "unbound";

export interface Candidate {
  user: UserRow;
  eligible: boolean;
  reason: CandidateReason;
  hoursSinceActive: number;
}

export function evaluateCandidate(
  user: UserRow,
  config: KeepaliveConfigRow,
  now = new Date(),
): Candidate {
  const lastActive = user.last_active_at ? new Date(user.last_active_at).getTime() : 0;
  const hoursSinceActive = lastActive ? (now.getTime() - lastActive) / HOUR_MS : Infinity;
  if (user.status !== "bound") {
    return { user, eligible: false, reason: "unbound", hoursSinceActive };
  }
  if (!isWindowOpen(user.last_active_at, now)) {
    return { user, eligible: false, reason: "window_closed", hoursSinceActive };
  }
  if (user.window_msg_count >= 10) {
    return { user, eligible: false, reason: "quota_full", hoursSinceActive };
  }
  const dueByQuota =
    user.window_msg_count >= Math.max(1, 10 - (config.quota_warn_at ?? 1));
  if (!lastActive || (hoursSinceActive < config.threshold_hours && !dueByQuota)) {
    return { user, eligible: false, reason: "not_due", hoursSinceActive };
  }
  const alreadySent = getDb()
    .prepare(
      `SELECT id FROM keepalive_logs WHERE user_id = ? AND status = 'sent'
         AND sent_at > ? LIMIT 1`,
    )
    .get(user.id, user.last_active_at ?? "1970-01-01");
  if (alreadySent) {
    return { user, eligible: false, reason: "already_sent", hoursSinceActive };
  }
  const dayStart = startOfShanghaiDayIso(now);
  const todayCount = (
    getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM keepalive_logs
         WHERE user_id = ? AND status = 'sent' AND sent_at >= ?`,
      )
      .get(user.id, dayStart) as { n: number }
  ).n;
  if (todayCount >= config.max_per_day) {
    return { user, eligible: false, reason: "daily_limit", hoursSinceActive };
  }
  return { user, eligible: true, reason: "eligible", hoursSinceActive };
}

export interface KeepaliveRunResult {
  ranAt: string;
  silent: boolean;
  checked: number;
  eligible: number;
  sent: number;
  failed: number;
  skipped: number;
  deferred: number;
  details: Array<{
    userId: number;
    name: string;
    status: "sent" | "failed" | "skipped" | "deferred";
    reason: string;
    message?: string;
  }>;
}

export async function runKeepalive(options: {
  dryRun?: boolean;
  now?: Date;
} = {}): Promise<KeepaliveRunResult> {
  const now = options.now ?? new Date();
  const config = getKeepaliveConfig();
  const result: KeepaliveRunResult = {
    ranAt: now.toISOString(),
    silent: false,
    checked: 0,
    eligible: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    deferred: 0,
    details: [],
  };
  if (!config.enabled) return result;

  const users = getDb()
    .prepare(
      `SELECT * FROM users WHERE status = 'bound' AND last_active_at IS NOT NULL
       ORDER BY last_active_at ASC`,
    )
    .all() as UserRow[];
  result.checked = users.length;
  const candidates = users.map((user) => evaluateCandidate(user, config, now));
  const eligible = candidates.filter((candidate) => candidate.eligible);
  result.eligible = eligible.length;

  if (isSilentNow(config.silent_start, config.silent_end, now)) {
    result.silent = true;
    result.deferred = eligible.length;
    result.details = eligible.map((candidate) => ({
      userId: candidate.user.id,
      name: getUserView(candidate.user.id).name,
      status: "deferred" as const,
      reason: `静默时段 ${config.silent_start}–${config.silent_end}，将在结束后补发`,
    }));
    return result;
  }
  if (options.dryRun) {
    result.details = eligible.map((candidate) => ({
      userId: candidate.user.id,
      name: getUserView(candidate.user.id).name,
      status: "skipped" as const,
      reason: `已超过 ${config.threshold_hours} 小时，窗口仍有效`,
    }));
    return result;
  }

  for (const candidate of eligible) {
    const view = getUserView(candidate.user.id);
    const content = renderKeepaliveTemplate(config.msg_template, view.name);
    try {
      await sendOutbound(candidate.user.id, {
        content,
        isKeepalive: true,
      });
      getDb()
        .prepare(
          "INSERT INTO keepalive_logs (user_id, status, reason, sent_at) VALUES (?, 'sent', NULL, ?)",
        )
        .run(candidate.user.id, nowIso());
      result.sent += 1;
      result.details.push({
        userId: candidate.user.id,
        name: view.name,
        status: "sent",
        reason: content,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      getDb()
        .prepare(
          "INSERT INTO keepalive_logs (user_id, status, reason, sent_at) VALUES (?, 'failed', ?, ?)",
        )
        .run(candidate.user.id, message, nowIso());
      result.failed += 1;
      result.details.push({
        userId: candidate.user.id,
        name: view.name,
        status: "failed",
        reason: message,
      });
    }
  }
  result.skipped = candidates.filter(
    (candidate) => !candidate.eligible && candidate.reason !== "not_due",
  ).length;
  emitToAdmins("keepalive:run", {
    ranAt: result.ranAt,
    sent: result.sent,
    failed: result.failed,
    deferred: result.deferred,
  });
  return result;
}

export function keepaliveStats() {
  const config = getKeepaliveConfig();
  const dayStart = startOfShanghaiDayIso(new Date());
  const today = getDb()
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM keepalive_logs WHERE sent_at >= ?`,
    )
    .get(dayStart) as { sent: number | null; failed: number | null };
  const lastRun = getDb()
    .prepare("SELECT * FROM keepalive_logs ORDER BY sent_at DESC LIMIT 1")
    .get() as { sent_at: string; status: string } | undefined;
  const eligibleUsers = (
    getDb()
      .prepare(
        "SELECT * FROM users WHERE status = 'bound' AND last_active_at IS NOT NULL",
      )
      .all() as UserRow[]
  ).filter((user) => evaluateCandidate(user, config).eligible);
  return {
    config,
    todaySent: today.sent ?? 0,
    todayFailed: today.failed ?? 0,
    lastRunAt: lastRun?.sent_at ?? null,
    candidates: eligibleUsers.length,
    today: dateKey(),
  };
}

export function previewKeepaliveMessage(name: string): string {
  return renderKeepaliveTemplate(getKeepaliveConfig().msg_template, name);
}

export function keepalivePresets() {
  return [
    {
      id: "warm",
      label: "温和问候",
      content:
        "您好{nickname_suffix}，有段时间没聊啦～如果还有任何问题，随时告诉我们，我们一直都在。",
    },
    {
      id: "care",
      label: "售后关怀",
      content:
        "您好{nickname_suffix}，想确认一下之前的问题都解决了吗？如果还有需要，直接回复我们就好～",
    },
    {
      id: "offer",
      label: "活动提醒",
      content:
        "您好{nickname_suffix}，最近上新了几款很适合您的单品，有任何想了解的都可以随时问我～",
    },
    {
      id: "plain",
      label: "简洁版",
      content: "在吗？有任何问题都可以随时告诉我～",
    },
  ];
}

