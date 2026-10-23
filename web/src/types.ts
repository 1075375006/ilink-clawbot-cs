export interface SupportAgent {
  id: number;
  username: string;
  name: string;
  enabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: number;
  name: string;
  nickname: string | null;
  remark: string | null;
  avatar: string | null;
  openid: string;
  ilinkBotId: string | null;
  baseurl: string | null;
  isActive: boolean;
  socialUid: string | null;
  loginType: string | null;
  status: "pending" | "bound" | "unbound";
  accountStatus: "pending_clawbot" | "active" | "unbound" | "session_expired";
  boundAt: string | null;
  lastActiveAt: string | null;
  windowExpiresAt: string | null;
  windowRemainingSeconds: number;
  windowState: "open" | "closed";
  replyUsed: number;
  replyRemaining: number;
  replyQuota: number;
  unread: number;
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastMessageDirection: "inbound" | "outbound" | null;
  lastMessageIsKeepalive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: number;
  userId: number;
  direction: "inbound" | "outbound";
  type: "text" | "image" | "file" | "template" | "system";
  content: string;
  mediaUrl: string | null;
  mediaName: string | null;
  mediaSize: number | null;
  mediaMime: string | null;
  isKeepalive: boolean;
  consumedQuota: boolean;
  isRead: boolean;
  status: "sent" | "delivered" | "failed" | "queued";
  error: string | null;
  sentAt: string;
}

export interface ChannelStatus {
  mode: "demo" | "live";
  configuredMode: "demo" | "live";
  connected: boolean;
  running: boolean;
  userBots?: number;
  botId: string | null;
  baseUrl: string | null;
  connectedAt: string | null;
  qrcodeImg: string | null;
  lastError: string | null;
  lastPollAt: string | null;
  sessionExpired: boolean;
  beichenConfigured: boolean;
  oauthConfigured?: boolean;
  oauthProvider?: string;
  customerQrUrl: string | null;
  publicBaseUrl: string;
  protocol: string;
}

export interface DashboardData {
  stats: {
    todayBindings: number;
    activeConversations: number;
    pendingReplies: number;
    todayKeepalive: number;
  };
  trend: Array<{ date: string; bindings: number; inbound: number; outbound: number }>;
  conversations: User[];
  keepaliveEnabled: boolean;
  channel: {
    mode: "demo" | "live";
    connected: boolean;
    running: boolean;
    botId: string | null;
    lastError: string | null;
    customerQrUrl?: string | null;
  };
}

export interface KeepaliveConfig {
  id: number;
  enabled: number;
  threshold_hours: number;
  msg_template: string;
  max_per_day: number;
  quota_warn_at: number;
  silent_start: string;
  silent_end: string;
  updated_at: string;
}

export interface KeepaliveData {
  config: KeepaliveConfig;
  todaySent: number;
  todayFailed: number;
  lastRunAt: string | null;
  candidates: number;
  today: string;
  presets: Array<{ id: string; label: string; content: string }>;
}

export interface BindingSession {
  token: string;
  status: "pending" | "scanned" | "awaiting_oauth" | "completed" | "expired" | "cancelled";
  mode: "demo" | "live";
  createdAt: string;
  expiresAt: string;
  scannedAt: string | null;
  completedAt: string | null;
  oauthUrl: string | null;
  oauthSent: boolean;
  ilinkBotId: string | null;
  scanStatus: string | null;
  pollError: string | null;
  customerQrUrl: string | null;
  user: User | null;
  conversation: Array<{
    id: number;
    direction: "inbound" | "outbound";
    type: string;
    content: string;
    mediaUrl: string | null;
    sentAt: string;
  }>;
}

export interface PushPreview {
  selected: number;
  reachable: number;
  unreachable: number;
  items: Array<{
    userId: number;
    name: string;
    avatar: string | null;
    reachable: boolean;
    reason: string;
  }>;
}
