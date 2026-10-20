import { getDb, type UserRow } from "../db.js";
import { lastNDateKeys, startOfShanghaiDayIso } from "../util/time.js";
import { listConversations } from "./users.js";
import { gateway } from "../ilink/gateway.js";
import { getKeepaliveConfig } from "./keepalive.js";

interface CountRow {
  n: number;
}

export function dashboardSummary() {
  const db = getDb();
  const dayStart = startOfShanghaiDayIso(new Date());
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const todayBindings = (
    db.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'bound' AND bound_at >= ?").get(dayStart) as CountRow
  ).n;
  const activeConversations = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM users
         WHERE status = 'bound' AND last_active_at >= ? AND window_msg_count < 10
           AND COALESCE(account_status, 'active') <> 'session_expired'`,
      )
      .get(dayAgo) as CountRow
  ).n;
  const pendingReplies = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT user_id) AS n FROM messages
         WHERE direction = 'inbound' AND is_read = 0
           AND user_id IN (SELECT id FROM users WHERE status = 'bound')`,
      )
      .get() as CountRow
  ).n;
  const todayKeepalive = (
    db
      .prepare("SELECT COUNT(*) AS n FROM keepalive_logs WHERE status = 'sent' AND sent_at >= ?")
      .get(dayStart) as CountRow
  ).n;

  const keys = lastNDateKeys(7);
  const bindingRows = db
    .prepare(
      `SELECT date(bound_at, '+8 hours') AS d, COUNT(*) AS n
       FROM users WHERE status = 'bound' AND bound_at >= ? GROUP BY d`,
    )
    .all(new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()) as Array<{ d: string; n: number }>;
  const msgRows = db
    .prepare(
      `SELECT date(sent_at, '+8 hours') AS d, direction, COUNT(*) AS n
       FROM messages WHERE sent_at >= ? GROUP BY d, direction`,
    )
    .all(new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()) as Array<{
    d: string;
    direction: string;
    n: number;
  }>;
  const bindingMap = new Map(bindingRows.map((row) => [row.d, row.n]));
  const msgMap = new Map<string, { inbound: number; outbound: number }>();
  msgRows.forEach((row) => {
    const entry = msgMap.get(row.d) ?? { inbound: 0, outbound: 0 };
    if (row.direction === "inbound") entry.inbound += row.n;
    else entry.outbound += row.n;
    msgMap.set(row.d, entry);
  });
  const trend = keys.map((key) => ({
    date: key,
    bindings: bindingMap.get(key) ?? 0,
    inbound: msgMap.get(key)?.inbound ?? 0,
    outbound: msgMap.get(key)?.outbound ?? 0,
  }));

  const conversations = listConversations().slice(0, 5);
  const config = getKeepaliveConfig();
  const channel = gateway.status();
  const channelRow = getDb()
    .prepare("SELECT customer_qr_url FROM channel_config WHERE id = 1")
    .get() as { customer_qr_url: string | null };
  return {
    stats: {
      todayBindings,
      activeConversations,
      pendingReplies,
      todayKeepalive,
    },
    trend,
    conversations,
    keepaliveEnabled: Boolean(config.enabled),
    channel: { ...channel, customerQrUrl: channelRow.customer_qr_url },
  };
}

export function unansweredUsers(): UserRow[] {
  return getDb()
    .prepare(
      `SELECT u.* FROM users u
       WHERE u.status = 'bound' AND EXISTS (
         SELECT 1 FROM messages m WHERE m.user_id = u.id AND m.direction = 'inbound' AND m.is_read = 0
       )
       ORDER BY u.last_active_at DESC`,
    )
    .all() as UserRow[];
}
