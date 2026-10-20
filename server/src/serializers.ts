import type { MessageRow, UserRow } from "./db.js";
import { displayName } from "./db.js";
import { windowRemainingSeconds } from "./util/time.js";

export interface UserStats {
  unread?: number;
  lastMessage?: string | null;
  lastMessageAt?: string | null;
  lastMessageDirection?: "inbound" | "outbound" | null;
  lastMessageIsKeepalive?: boolean;
  replyUsed?: number;
}

export function serializeUser(
  user: UserRow,
  stats: UserStats = {},
  quotaPerWindow = 10,
) {
  const remaining = windowRemainingSeconds(user.last_active_at);
  const replyUsed = stats.replyUsed ?? 0;
  return {
    id: user.id,
    name: displayName(user),
    nickname: user.nickname,
    remark: user.remark,
    avatar: user.faceimg,
    openid: user.clawbot_openid,
    ilinkBotId: user.ilink_bot_id ?? user.clawbot_openid,
    baseurl: user.baseurl,
    isActive: Boolean(user.is_active),
    socialUid: user.social_uid,
    loginType: user.login_type,
    status: user.status,
    accountStatus:
      user.account_status ??
      (user.status === "bound" ? "active" : user.status === "unbound" ? "unbound" : "pending_clawbot"),
    boundAt: user.bound_at,
    lastActiveAt: user.last_active_at,
    windowExpiresAt: user.window_expires_at,
    windowRemainingSeconds: remaining,
    windowState: remaining > 0 ? "open" : "closed",
    replyUsed,
    replyRemaining: Math.max(0, quotaPerWindow - replyUsed),
    replyQuota: quotaPerWindow,
    unread: stats.unread ?? 0,
    lastMessage: stats.lastMessage ?? null,
    lastMessageAt: stats.lastMessageAt ?? null,
    lastMessageDirection: stats.lastMessageDirection ?? null,
    lastMessageIsKeepalive: Boolean(stats.lastMessageIsKeepalive),
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

export function serializeMessage(message: MessageRow) {
  const type =
    message.msg_type === "template" ? (message.media_url ? "file" : message.msg_type) : message.msg_type;
  return {
    id: message.id,
    userId: message.user_id,
    direction: message.direction,
    type,
    content: message.content,
    mediaUrl: message.media_url,
    mediaName: message.media_name ?? null,
    mediaSize: message.media_size ?? null,
    mediaMime: message.media_mime ?? null,
    isKeepalive: Boolean(message.is_keepalive),
    consumedQuota: Boolean(message.consumed_quota),
    isRead: Boolean(message.is_read),
    status: message.delivery_status,
    error: message.error,
    sentAt: message.sent_at,
  };
}

export type UserView = ReturnType<typeof serializeUser>;
export type MessageView = ReturnType<typeof serializeMessage>;
