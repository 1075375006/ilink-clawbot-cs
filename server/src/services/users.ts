import { getDb, displayName, getSetting, type UserRow } from "../db.js";
import { serializeUser, type UserStats } from "../serializers.js";
import { emitToAdmins } from "../realtime.js";
import { AppError, notFound } from "../errors.js";

export function replyQuotaPerWindow(): number {
  return Math.max(1, Math.min(50, getSetting("replyQuotaPerWindow", 10)));
}

interface ListRow extends UserRow {
  unread: number;
  last_message: string | null;
  last_message_at: string | null;
  last_message_direction: "inbound" | "outbound" | null;
  last_message_keepalive: number | null;
  reply_used: number;
}

const LIST_SELECT = `
  SELECT u.*,
    (SELECT COUNT(*) FROM messages m
      WHERE m.user_id = u.id AND m.direction = 'inbound' AND m.is_read = 0) AS unread,
    (SELECT m.content FROM messages m WHERE m.user_id = u.id
      ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS last_message,
    (SELECT m.sent_at FROM messages m WHERE m.user_id = u.id
      ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS last_message_at,
    (SELECT m.direction FROM messages m WHERE m.user_id = u.id
      ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS last_message_direction,
    (SELECT m.is_keepalive FROM messages m WHERE m.user_id = u.id
      ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS last_message_keepalive,
    u.window_msg_count AS reply_used
  FROM users u
`;

function toView(row: ListRow) {
  const stats: UserStats = {
    unread: row.unread,
    lastMessage: row.last_message,
    lastMessageAt: row.last_message_at,
    lastMessageDirection: row.last_message_direction,
    lastMessageIsKeepalive: Boolean(row.last_message_keepalive),
    replyUsed: row.reply_used,
  };
  return serializeUser(row, stats, replyQuotaPerWindow());
}

export function getUserById(id: number): UserRow {
  const user = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  if (!user) throw notFound("客户不存在");
  return user;
}

export function getBoundUser(id: number): UserRow {
  const user = getUserById(id);
  if (user.status !== "bound") {
    throw new AppError(409, "USER_NOT_BOUND", "该客户尚未完成身份绑定。");
  }
  return user;
}

export function getUserView(id: number) {
  const row = getDb()
    .prepare(`${LIST_SELECT} WHERE u.id = ?`)
    .get(id) as ListRow | undefined;
  if (!row) throw notFound("客户不存在");
  return toView(row);
}

export function listUsers(params: {
  search?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  window?: "all" | "open" | "closed";
  clawbot?: "all" | "invalid";
}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const search = (params.search ?? "").trim();
  const where: string[] = ["u.status = 'bound'"];
  const values: unknown[] = [];
  if (search) {
    where.push(
      "(COALESCE(u.remark,'') LIKE ? OR COALESCE(u.nickname,'') LIKE ? OR u.social_uid LIKE ? OR u.clawbot_openid LIKE ? OR u.ilink_bot_id LIKE ?)",
    );
    const like = `%${search}%`;
    values.push(like, like, like, like, like);
  }
  if (params.window === "open" || params.window === "closed") {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    if (params.window === "open") {
      where.push("u.last_active_at > ?");
    } else {
      where.push("(u.last_active_at IS NULL OR u.last_active_at <= ?)");
    }
    values.push(cutoff);
  }
  if (params.clawbot === "invalid") {
    where.push("u.account_status = 'session_expired'");
  }
  const order =
    params.sort === "bound_asc"
      ? "u.bound_at ASC"
      : params.sort === "active_desc"
        ? "u.last_active_at DESC"
        : params.sort === "active_asc"
          ? "u.last_active_at ASC"
          : "u.bound_at DESC";
  const whereSql = where.join(" AND ");
  const total = (
    getDb()
      .prepare(`SELECT COUNT(*) AS n FROM users u WHERE ${whereSql}`)
      .get(...values) as { n: number }
  ).n;
  const rows = getDb()
    .prepare(`${LIST_SELECT} WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...values, pageSize, (page - 1) * pageSize) as ListRow[];
  return {
    items: rows.map(toView),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function listConversations(search = "") {
  const like = `%${search.trim()}%`;
  const rows = getDb()
    .prepare(
      `${LIST_SELECT}
       WHERE u.status = 'bound'
         AND u.last_active_at IS NOT NULL
         AND (? = '%%' OR COALESCE(u.remark,'') LIKE ? OR COALESCE(u.nickname,'') LIKE ?)
       ORDER BY COALESCE(last_message_at, u.bound_at) DESC
       LIMIT 200`,
    )
    .all(like, like, like) as ListRow[];
  return rows.map(toView);
}

export function markConversationRead(userId: number): number {
  const result = getDb()
    .prepare("UPDATE messages SET is_read = 1 WHERE user_id = ? AND direction = 'inbound' AND is_read = 0")
    .run(userId);
  if (result.changes > 0) {
    emitToAdmins("conversation:read", { userId });
  }
  return result.changes;
}

export function countReplyUsed(userId: number): number {
  const user = getUserById(userId);
  return user.window_msg_count;
}

export function updateRemark(userId: number, remark: string) {
  const user = getUserById(userId);
  if (user.status !== "bound") {
    throw new AppError(409, "USER_NOT_BOUND", "该客户尚未完成身份绑定。");
  }
  const value = remark.trim().slice(0, 30);
  if (!value) throw new AppError(400, "INVALID_REMARK", "备注名不能为空。");
  getDb()
    .prepare("UPDATE users SET remark = ?, updated_at = ? WHERE id = ?")
    .run(value, new Date().toISOString(), userId);
  const view = getUserView(userId);
  emitToAdmins("customer:updated", view);
  return view;
}

export function userLabel(user: Pick<UserRow, "remark" | "nickname" | "social_uid">): string {
  return displayName(user);
}
