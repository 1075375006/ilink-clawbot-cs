import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  CheckCheck,
  Clock3,
  Copy,
  Download,
  FileText,
  Info,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Pencil,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, api, uploadFile, type UploadResult } from "../api";
import type { Message, User } from "../types";
import {
  dayjs,
  duration,
  fullTime,
  loginLabel,
  relativeDay,
  shortTime,
} from "../lib/format";
import { remainingSeconds, useNow } from "../lib/useNow";
import { Avatar } from "../components/Avatar";
import { EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import { useToast } from "../store/ToastContext";

interface ConversationsResponse {
  items: User[];
}

interface MessagesResponse {
  items: Message[];
  hasMore: boolean;
  nextBeforeId: number | null;
}

function MessageBubble({
  message,
  user,
  onImage,
}: {
  message: Message;
  user: User;
  onImage: (url: string) => void;
}) {
  if (message.type === "system") {
    const authLink = message.content.includes("/api/oauth");
    return (
      <div className="system-message">
        <Info size={13} />
        <span>{authLink ? "身份授权链接已发送给客户" : message.content}</span>
      </div>
    );
  }
  const mine = message.direction === "outbound";
  return (
    <div className={`message-row ${mine ? "mine" : "theirs"}`}>
      {!mine ? <Avatar src={user.avatar} name={user.name} size={32} className="bubble-avatar" /> : null}
      <div className={`bubble-wrap ${mine ? "right" : ""}`}>
        {message.isKeepalive ? (
          <span className="bubble-tag">
            <Sparkles size={11} /> 保活消息
          </span>
        ) : null}
        <div
          className={`bubble ${mine ? "bubble-out" : "bubble-in"} ${
            message.type === "image" || message.type === "file" ? "bubble-media" : ""
          }`}
        >
          {message.type === "image" && message.mediaUrl ? (
            <button type="button" className="chat-image" onClick={() => onImage(message.mediaUrl!)}>
              <img src={message.mediaUrl} alt="聊天图片" />
            </button>
          ) : null}
          {message.type === "file" && message.mediaUrl ? (
            <a
              className="chat-file"
              href={message.mediaUrl}
              download={message.mediaName ?? undefined}
              target="_blank"
              rel="noreferrer"
            >
              <span className="chat-file-icon">
                <FileText size={18} />
              </span>
              <span className="chat-file-meta">
                <strong>{message.mediaName || message.content || "文件"}</strong>
                {message.mediaSize ? (
                  <small>{Math.max(1, Math.round(message.mediaSize / 1024))} KB</small>
                ) : null}
              </span>
              <Download size={15} />
            </a>
          ) : null}
          {message.content &&
          message.content !== "图片" &&
          message.content !== message.mediaName ? (
            <p>{message.content}</p>
          ) : null}
        </div>
        <div className={`bubble-meta ${mine ? "align-right" : ""}`}>
          <span>{dayjs(message.sentAt).format("HH:mm")}</span>
          {mine ? (
            message.status === "failed" ? (
              <span className="send-failed">
                <AlertTriangle size={12} /> 发送失败
              </span>
            ) : (
              <CheckCheck size={13} />
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ChatPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const listMode = searchParams.get("list") === "1";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const now = useNow();
  const selectedId = id ? Number(id) : null;
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [pendingMedia, setPendingMedia] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [simulateOpen, setSimulateOpen] = useState(false);
  const [simulateText, setSimulateText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [remarkEditing, setRemarkEditing] = useState(false);
  const [remarkDraft, setRemarkDraft] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const lastTypingRef = useRef(0);
  const [showJump, setShowJump] = useState(false);

  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api<ConversationsResponse>("/api/conversations"),
  });

  useEffect(() => {
    if (!id && !listMode && conversations.data?.items.length) {
      navigate(`/workbench/${conversations.data.items[0]!.id}`, { replace: true });
    }
  }, [conversations.data, id, listMode, navigate]);

  const { data: userData } = useQuery({
    queryKey: ["user", selectedId],
    queryFn: () => api<{ user: User }>(`/api/users/${selectedId}`),
    enabled: Boolean(selectedId),
  });

  const messagesQuery = useInfiniteQuery({
    queryKey: ["messages", selectedId],
    enabled: Boolean(selectedId),
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      api<MessagesResponse>(
        `/api/users/${selectedId}/messages?limit=40${
          pageParam ? `&beforeId=${pageParam}` : ""
        }`,
      ),
    getNextPageParam: (last) => (last.hasMore ? last.nextBeforeId ?? undefined : undefined),
  });

  const user = userData?.user;
  const items = useMemo(
    () =>
      [...(messagesQuery.data?.pages ?? [])]
        .reverse()
        .flatMap((page) => page.items),
    [messagesQuery.data],
  );

  const filtered = useMemo(() => {
    const list = conversations.data?.items ?? [];
    if (!search.trim()) return list;
    return list.filter((item) => item.name.includes(search.trim()));
  }, [conversations.data, search]);

  useEffect(() => {
    if (!selectedId) return;
    setDraft("");
    setPendingMedia(null);
    setMenuOpen(false);
    setRemarkEditing(false);
  }, [selectedId, queryClient]);

  const lastMessageId = items.length ? items[items.length - 1]!.id : null;
  useEffect(() => {
    if (!selectedId || !lastMessageId) return;
    queryClient.setQueryData<ConversationsResponse>(["conversations"], (current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) =>
              item.id === selectedId ? { ...item, unread: 0 } : item,
            ),
          }
        : current,
    );
    api(`/api/users/${selectedId}/read`, { method: "POST" })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      })
      .catch(() => undefined);
  }, [selectedId, lastMessageId, queryClient]);

  useEffect(() => {
    if (!items.length) return;
    if (atBottomRef.current) {
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    } else {
      setShowJump(true);
    }
  }, [items.length, selectedId]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("未选择客户");
      if (!draft.trim() && !pendingMedia) {
        throw new ApiError(400, "EMPTY_MESSAGE", "请输入消息内容。");
      }
      const msgType = pendingMedia
        ? pendingMedia.isImage
          ? "image"
          : "file"
        : "text";
      return api<{ message: Message }>(`/api/users/${selectedId}/messages`, {
        method: "POST",
        json: {
          content: draft.trim(),
          msgType,
          mediaUrl: pendingMedia?.url ?? null,
          mediaName: pendingMedia?.name ?? null,
          mediaSize: pendingMedia?.size ?? null,
          mediaMime: pendingMedia?.mimeType ?? null,
        },
      });
    },
    onSuccess: () => {
      setDraft("");
      setPendingMedia(null);
      atBottomRef.current = true;
      queryClient.invalidateQueries({ queryKey: ["messages", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["user", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : "消息发送失败", "error");
    },
  });

  const remarkMutation = useMutation({
    mutationFn: (remark: string) =>
      api<{ user: User }>(`/api/users/${selectedId}`, {
        method: "PATCH",
        json: { remark },
      }),
    onSuccess: () => {
      setRemarkEditing(false);
      toast("备注名已更新");
      queryClient.invalidateQueries({ queryKey: ["user", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "更新失败", "error"),
  });

  const refreshMutation = useMutation({
    mutationFn: () =>
      api<{ user: User }>(`/api/users/${selectedId}/refresh-info`, { method: "POST" }),
    onSuccess: () => {
      toast("已刷新客户资料");
      queryClient.invalidateQueries({ queryKey: ["user", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "刷新失败", "error"),
  });

  const simulateMutation = useMutation({
    mutationFn: () =>
      api(`/api/channel/demo/inbound`, {
        method: "POST",
        json: { userId: selectedId, content: simulateText.trim() },
      }),
    onSuccess: () => {
      setSimulateOpen(false);
      setSimulateText("");
      atBottomRef.current = true;
      queryClient.invalidateQueries({ queryKey: ["messages", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["user", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast("已模拟一条客户消息", "info");
    },
    onError: (error) => toast(error instanceof Error ? error.message : "模拟失败", "error"),
  });

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const isImage = ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type);
    if (file.type.startsWith("image/") && !isImage) {
      toast("仅支持 PNG / JPG / WEBP / GIF 图片", "error");
      return;
    }
    if (file.size > (isImage ? 8 : 20) * 1024 * 1024) {
      toast(isImage ? "图片不能超过 8MB" : "文件不能超过 20MB", "error");
      return;
    }
    setUploading(true);
    try {
      const result = await uploadFile(file);
      setPendingMedia(result);
    } catch (error) {
      toast(error instanceof Error ? error.message : "上传失败", "error");
    } finally {
      setUploading(false);
    }
  };

  const submit = () => {
    if (sendMutation.isPending || uploading) return;
    if (!draft.trim() && !pendingMedia) return;
    sendMutation.mutate();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const requestTyping = () => {
    if (!selectedId) return;
    const nowMs = Date.now();
    if (nowMs - lastTypingRef.current < 2_000) return;
    lastTypingRef.current = nowMs;
    api(`/api/users/${selectedId}/typing`, { method: "POST" }).catch(() => undefined);
  };

  const windowSeconds = remainingSeconds(user?.windowExpiresAt ?? null, now);
  const closed = Boolean(user) && windowSeconds <= 0;
  const quotaLeft = user ? Math.max(0, user.replyQuota - user.replyUsed) : 0;
  const quotaExhausted = Boolean(user) && quotaLeft <= 0;
  const channelExpired = user?.accountStatus === "session_expired";
  const inputDisabled = closed || quotaExhausted || channelExpired;
  const quotaUsedPct = user ? Math.min(100, (user.replyUsed / user.replyQuota) * 100) : 0;
  const urgent = windowSeconds > 0 && windowSeconds < 2 * 3600;

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setShowJump(false);
    atBottomRef.current = true;
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    atBottomRef.current = bottom;
    if (bottom) setShowJump(false);
  };

  return (
    <div className={`chat-layout ${selectedId ? "chat-selected" : ""}`}>
      <aside className="chat-list">
        <div className="chat-list-head">
          <div>
            <h2>对话</h2>
            <span>{conversations.data?.items.length ?? 0} 位客户</span>
          </div>
          <button type="button" className="icon-btn" onClick={() => queryClient.invalidateQueries({ queryKey: ["conversations"] })}>
            <RefreshCw size={16} />
          </button>
        </div>
        <div className="chat-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索客户"
          />
        </div>
        <div className="chat-list-scroll">
          {filtered.map((item) => {
            const seconds = remainingSeconds(item.windowExpiresAt, now);
            return (
              <button
                type="button"
                key={item.id}
                className={`conversation-item ${item.id === selectedId ? "active" : ""}`}
                onClick={() => navigate(`/workbench/${item.id}`)}
              >
                <span className="avatar-wrap">
                  <Avatar src={item.avatar} name={item.name} size={34} />
                  {item.unread > 0 ? <i className="avatar-badge">{item.unread}</i> : null}
                </span>
                <span className="conv-main">
                  <span className="conv-top">
                    <strong>{item.name}</strong>
                    <time>{shortTime(item.lastMessageAt ?? item.lastActiveAt)}</time>
                  </span>
                  <span className="conv-bottom">
                    <span className="conv-msg">
                      {item.lastMessageDirection === "outbound" ? (
                        <em className="conv-me">{item.lastMessageIsKeepalive ? "保活：" : "我："}</em>
                      ) : null}
                      {item.lastMessage
                        ? item.lastMessage.startsWith("http")
                          ? "身份授权链接"
                          : item.lastMessage
                        : "开始新的对话"}
                    </span>
                    {seconds > 0 ? (
                      <i className={`conv-dot ${seconds < 7200 ? "urgent" : ""}`} />
                    ) : (
                      <i className="conv-dot closed" />
                    )}
                  </span>
                </span>
              </button>
            );
          })}
          {!filtered.length ? (
            <EmptyState
              icon={<MessageCircle size={20} />}
              title={search ? "没有匹配的会话" : "还没有会话"}
              description={search ? "换个关键词试试" : "客户发来消息后会出现在这里"}
            />
          ) : null}
        </div>
        <div className="chat-list-foot">
          <span className="status-dot online" />
          消息实时同步中
        </div>
      </aside>

      <section className="chat-main">
        {!selectedId || !user ? (
          <div className="chat-placeholder">
            <span className="chat-placeholder-icon">
              <MessageCircle size={30} />
            </span>
            <h3>选择一位客户开始对话</h3>
            <p>从左侧列表中选择客户，或先邀请客户扫码绑定 ClawBot。</p>
            <Link to="/invite" className="btn btn-primary btn-sm" style={{ marginTop: 14 }}>
              生成客户绑定二维码
            </Link>
          </div>
        ) : (
          <>
            <header className="chat-header">
              <button type="button" className="icon-btn chat-back" onClick={() => navigate("/workbench?list=1")}>
                <ArrowLeft size={18} />
              </button>
              <Avatar src={user.avatar} name={user.name} size={48} />
              <div className="chat-header-main">
                <div className="chat-header-name">
                  <h3>{user.name}</h3>
                  <span className="login-badge">{loginLabel(user.loginType)}</span>
                </div>
                <div className={`window-line ${urgent ? "urgent" : ""} ${closed ? "closed" : ""}`}>
                  <Clock3 size={13} />
                  {closed ? (
                    <span>对话窗口已关闭</span>
                  ) : (
                    <span>
                      窗口剩余 <strong>{duration(windowSeconds)}</strong>
                      {urgent ? " · 即将关闭" : ""}
                    </span>
                  )}
                  <i className="meta-sep" />
                  <span>
                    本次窗口已用 {user.replyUsed}/10
                  </span>
                  {quotaLeft <= 2 && !closed ? (
                    <span className="quota-risk">仅剩 {quotaLeft} 条</span>
                  ) : null}
                </div>
              </div>
              <div className="chat-header-actions">
                <span className="chat-quota" title="本窗口剩余回复条数">
                  <span className="quota-ring" style={{ background: `conic-gradient(#2E86AB ${quotaUsedPct}%, #E8EEF6 0)` }}>
                    <i />
                  </span>
                  <span>
                    <strong>{quotaLeft}</strong>
                    <small>条可回复</small>
                  </span>
                </span>
                <div className="menu-wrap">
                  <button type="button" className="icon-btn" onClick={() => setMenuOpen((open) => !open)}>
                    <MoreHorizontal size={19} />
                  </button>
                  {menuOpen ? (
                    <>
                      <div className="menu-scrim" onClick={() => setMenuOpen(false)} />
                      <div className="dropdown-menu">
                        <button type="button" onClick={() => { setMenuOpen(false); refreshMutation.mutate(); }}>
                          <RefreshCw size={15} /> 刷新客户资料
                        </button>
                        <button type="button" onClick={() => { setMenuOpen(false); setSimulateOpen(true); }}>
                          <Sparkles size={15} /> 模拟客户消息
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(user.ilinkBotId ?? user.openid);
                            setMenuOpen(false);
                            toast("ilink_bot_id 已复制");
                          }}
                        >
                          <Copy size={15} /> 复制 ilink_bot_id
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </header>

            {channelExpired ? (
              <div className="window-banner danger">
                <AlertTriangle size={16} />
                <span>ClawBot 登录已失效，请客户重新扫码绑定后再发送消息。</span>
              </div>
            ) : closed ? (
              <div className="window-banner">
                <AlertTriangle size={16} />
                <span>对话窗口已关闭，等待客户主动发言后即可恢复。你仍可以查看历史消息。</span>
              </div>
            ) : urgent ? (
              <div className="window-banner warning">
                <Clock3 size={16} />
                <span>窗口将在 {duration(windowSeconds)} 后关闭，建议尽快回复或发送保活消息。</span>
              </div>
            ) : null}

            <div className="message-scroll" ref={scrollRef} onScroll={onScroll}>
              {messagesQuery.hasNextPage ? (
                <div className="load-older">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={messagesQuery.isFetchingNextPage}
                    onClick={() => messagesQuery.fetchNextPage()}
                  >
                    {messagesQuery.isFetchingNextPage ? <Loader2 size={14} className="spin" /> : null}
                    加载更早消息
                  </button>
                </div>
              ) : null}
              {items.map((message, index) => {
                const prev = items[index - 1];
                const newDay = !prev || !dayjs(prev.sentAt).isSame(dayjs(message.sentAt), "day");
                const gapMinutes = prev
                  ? dayjs(message.sentAt).diff(dayjs(prev.sentAt), "minute")
                  : 0;
                return (
                  <div key={message.id}>
                    {newDay ? (
                      <div className="date-separator">
                        <span>{relativeDay(message.sentAt)}</span>
                      </div>
                    ) : null}
                    {!newDay && gapMinutes > 30 ? (
                      <div className="time-separator">
                        <span>{dayjs(message.sentAt).format("HH:mm")}</span>
                      </div>
                    ) : null}
                    <MessageBubble message={message} user={user} onImage={setLightbox} />
                  </div>
                );
              })}
              {!items.length && !messagesQuery.isLoading ? (
                <EmptyState
                  icon={<MessageCircle size={22} />}
                  title="还没有消息"
                  description="发一条消息，开启和客户的第一次对话。"
                />
              ) : null}
            </div>

            {showJump ? (
              <button type="button" className="jump-new" onClick={scrollToBottom}>
                <ArrowDown size={14} /> 回到最新
              </button>
            ) : null}

            <footer className="composer">
              {pendingMedia ? (
                <div className={`pending-image ${pendingMedia.isImage ? "" : "pending-file"}`}>
                  {pendingMedia.isImage ? (
                    <img src={pendingMedia.url} alt={pendingMedia.name} />
                  ) : (
                    <span className="pending-file-chip">
                      <FileText size={16} />
                      <span>
                        <strong>{pendingMedia.name}</strong>
                        <small>{Math.max(1, Math.round(pendingMedia.size / 1024))} KB</small>
                      </span>
                    </span>
                  )}
                  <button type="button" onClick={() => setPendingMedia(null)} aria-label="移除附件">
                    <X size={14} />
                  </button>
                </div>
              ) : null}
              <div className={`composer-box ${inputDisabled ? "disabled" : ""}`}>
                <textarea
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    requestTyping();
                  }}
                  onKeyDown={onKeyDown}
                  placeholder={
                    channelExpired
                      ? "ClawBot 登录已失效，请客户重新扫码绑定"
                      : inputDisabled
                        ? "对话窗口已关闭 / 本轮配额已用尽，等待用户主动发言后自动恢复"
                      : "输入消息，Enter 发送，Shift + Enter 换行"
                  }
                  disabled={inputDisabled}
                  rows={1}
                  maxLength={30000}
                />
                <div className="composer-tools">
                  <input
                    ref={fileRef}
                    type="file"
                    hidden
                    onChange={upload}
                  />
                  <button
                    type="button"
                    className="tool-btn"
                    onClick={() => fileRef.current?.click()}
                    disabled={inputDisabled || uploading}
                    title="发送图片或文件"
                  >
                    {uploading ? <Loader2 size={17} className="spin" /> : <Paperclip size={17} />}
                  </button>
                  <span className="composer-hint">
                    {draft.length > 0
                      ? `${new TextEncoder().encode(draft).length} 字节 · ${Math.max(
                          1,
                          Math.ceil(
                            new TextEncoder().encode(draft).length / 16384,
                          ),
                        )} 段`
                      : "支持文字、图片与文件"}
                  </span>
                  <span className="window-usage">
                    本次窗口已用 <strong>{user.replyUsed}/10</strong> 条
                  </span>
                  <button
                    type="button"
                    className="send-btn"
                    disabled={inputDisabled || sendMutation.isPending || (!draft.trim() && !pendingMedia)}
                    onClick={submit}
                  >
                    {sendMutation.isPending ? <Loader2 size={17} className="spin" /> : <Send size={17} />}
                    发送
                  </button>
                </div>
              </div>
              {quotaExhausted && !closed ? (
                <div className="composer-note danger">
                  本轮 10 条配额已用尽，等待客户主动发言后自动恢复。
                </div>
              ) : null}
            </footer>
          </>
        )}
      </section>

      {selectedId && user ? (
        <aside className="customer-panel">
          <div className="customer-hero">
            <Avatar src={user.avatar} name={user.name} size={72} />
            <div className="customer-name-row">
              {remarkEditing ? (
                <form
                  className="remark-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (remarkDraft.trim()) remarkMutation.mutate(remarkDraft.trim());
                  }}
                >
                  <input
                    autoFocus
                    value={remarkDraft}
                    onChange={(event) => setRemarkDraft(event.target.value)}
                    maxLength={30}
                    placeholder="输入备注名"
                  />
                  <button type="submit" className="btn btn-tiny" disabled={remarkMutation.isPending}>
                    保存
                  </button>
                </form>
              ) : (
                <>
                  <h3>{user.name}</h3>
                  <button
                    type="button"
                    className="icon-btn tiny"
                    onClick={() => {
                      setRemarkDraft(user.remark || user.nickname || "");
                      setRemarkEditing(true);
                    }}
                    title="修改备注名"
                  >
                    <Pencil size={13} />
                  </button>
                </>
              )}
            </div>
            <span className="customer-sub">{loginLabel(user.loginType)}授权 · ClawBot 已绑定</span>
            <div className="customer-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => refreshMutation.mutate()}>
                <RefreshCw size={14} /> 刷新资料
              </button>
            </div>
          </div>

          <div className="panel-section">
            <h4>窗口状态</h4>
            <div className="window-card">
              <div className={`window-card-top ${closed ? "closed" : urgent ? "urgent" : ""}`}>
                <Clock3 size={16} />
                <strong>{closed ? "已关闭" : duration(windowSeconds)}</strong>
                <span>{closed ? "等待客户发言" : "后关闭"}</span>
              </div>
              <div className="window-track">
                <i style={{ width: `${Math.min(100, (windowSeconds / 86400) * 100)}%` }} />
              </div>
              <p>客户每次主动发言，窗口重新计算 24 小时。</p>
            </div>
          </div>

          <div className="panel-section">
            <h4>本窗口回复额度</h4>
            <div className="quota-block">
              <div className="quota-top">
                <strong>{quotaLeft}</strong>
                <span>/ {user.replyQuota} 条剩余</span>
              </div>
              <div className="quota-bar">
                <i style={{ width: `${quotaUsedPct}%` }} className={quotaLeft <= 2 ? "low" : ""} />
              </div>
              <p>额度按 iLink 通道规则保护，客户再次发言后重置。</p>
            </div>
          </div>

          <div className="panel-section">
            <h4>客户信息</h4>
            <dl className="info-list">
              <div>
                <dt>绑定时间</dt>
                <dd>{fullTime(user.boundAt)}</dd>
              </div>
              <div>
                <dt>最后活跃</dt>
                <dd>{fullTime(user.lastActiveAt)}</dd>
              </div>
              <div>
                <dt>social_uid</dt>
                <dd className="mono">{user.socialUid ?? "—"}</dd>
              </div>
              <div>
                <dt>ilink_bot_id</dt>
                <dd className="mono ellipsis">{user.ilinkBotId ?? "—"}</dd>
              </div>
              <div>
                <dt>baseurl</dt>
                <dd className="mono ellipsis">{user.baseurl ?? "—"}</dd>
              </div>
            </dl>
          </div>

          <div className="panel-section panel-section-last">
            <div className="trust-note">
              <ShieldCheck size={15} />
              <span>头像与昵称来自聚合登录授权，仅在绑定时获取。</span>
            </div>
          </div>
        </aside>
      ) : null}

      <Modal open={Boolean(lightbox)} title="查看图片" onClose={() => setLightbox(null)} width={760}>
        {lightbox ? <img className="lightbox-img" src={lightbox} alt="聊天图片" /> : null}
      </Modal>

      <Modal
        open={simulateOpen}
        title="模拟客户消息"
        description="仅用于演示通道，模拟客户在 ClawBot 中给你发消息。"
        onClose={() => setSimulateOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setSimulateOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!simulateText.trim() || simulateMutation.isPending}
              onClick={() => simulateMutation.mutate()}
            >
              {simulateMutation.isPending ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
              模拟发送
            </button>
          </>
        }
      >
        <div className="simulate-box">
          <textarea
            value={simulateText}
            onChange={(event) => setSimulateText(event.target.value)}
            placeholder="例如：你好，想咨询一下这款还有货吗？"
            rows={4}
            maxLength={1000}
          />
          <p>发送后会立即出现在当前会话中，并重置 24 小时窗口。</p>
        </div>
      </Modal>
    </div>
  );
}
