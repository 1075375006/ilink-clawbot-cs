import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronDown,
  Download,
  FileText,
  Headphones,
  Image as ImageIcon,
  Info,
  Loader2,
  LogOut,
  MessageCircle,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Smile,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { io } from "socket.io-client";
import { ApiError, api, uploadFile, type UploadResult } from "../api";
import type { Message, User } from "../types";
import { Avatar } from "../components/Avatar";
import { Modal } from "../components/Modal";
import { dayjs, duration, fullTime, shortTime } from "../lib/format";
import { remainingSeconds, useNow } from "../lib/useNow";
import { useSupportAuth } from "../store/SupportAuthContext";
import { useToast } from "../store/ToastContext";
import { useMobileViewport } from "../lib/useMobileViewport";

interface MessagePage {
  items: Message[];
  hasMore: boolean;
  nextBeforeId: number | null;
}
const EMOJI = [
  "😊",
  "🙂",
  "👍",
  "❤️",
  "🌹",
  "🙏",
  "🎉",
  "✅",
  "🤝",
  "☀️",
  "✨",
  "🙌",
];
const bytes = (size: number) =>
  size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;

function SupportBubble({
  message,
  user,
  onImage,
  onMediaLoad,
}: {
  message: Message;
  user: User;
  onImage: (url: string) => void;
  onMediaLoad: () => void;
}) {
  if (message.type === "system")
    return (
      <div className="support-system-message">
        {message.content.includes("/api/oauth")
          ? "客户身份授权流程"
          : message.content}
      </div>
    );
  const mine = message.direction === "outbound";
  return (
    <div className={`support-message ${mine ? "mine" : ""}`}>
      <Avatar
        name={mine ? "客服" : user.name}
        src={mine ? null : user.avatar}
        size={36}
      />
      <div className="support-message-wrap">
        {message.isKeepalive ? (
          <span className="support-keepalive-tag">客户关怀消息</span>
        ) : null}
        <div
          className={`support-bubble ${message.type === "image" ? "is-image" : ""}`}
        >
          {message.type === "image" && message.mediaUrl ? (
            <button
              className="support-image-button"
              onClick={() => onImage(message.mediaUrl!)}
              aria-label="查看聊天图片"
            >
              <img
                src={message.mediaUrl}
                alt="聊天图片"
                loading="lazy"
                onLoad={onMediaLoad}
              />
            </button>
          ) : null}
          {message.type === "file" && message.mediaUrl ? (
            <a
              className="support-file-card"
              href={message.mediaUrl}
              download={message.mediaName ?? undefined}
              target="_blank"
              rel="noreferrer"
            >
              <span>
                <FileText size={25} />
              </span>
              <div>
                <strong>{message.mediaName || "文件"}</strong>
                <small>
                  {message.mediaSize
                    ? bytes(message.mediaSize)
                    : "点击下载附件"}
                </small>
              </div>
              <Download size={16} />
            </a>
          ) : null}
          {message.content &&
          message.content !== "图片" &&
          !(
            message.type === "file" && message.content === message.mediaName
          ) ? (
            <p>{message.content}</p>
          ) : null}
        </div>
        {mine ? (
          <span
            className={`support-message-status ${message.status === "failed" ? "failed" : ""}`}
            title={message.error ?? undefined}
          >
            {message.status === "failed" ? (
              "发送失败"
            ) : (
              <>
                <CheckCheck size={12} />
                已发送
              </>
            )}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function SupportChatPage() {
  const { id } = useParams();
  const selectedId = id && /^\d+$/.test(id) ? Number(id) : null;
  const { agent, logout, expire } = useSupportAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [contacts, setContacts] = useState(false);
  const [connected, setConnected] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const viewport = useMobileViewport();
  const now = useNow();

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  const conversations = useQuery({
    queryKey: ["support", agent?.id, "conversations"],
    queryFn: () => api<{ items: User[] }>("/api/support/conversations"),
    refetchInterval: 15_000,
  });
  const items = conversations.data?.items ?? [];
  const unread = items.reduce((total, user) => total + user.unread, 0);
  const filtered = useMemo(() => {
    const list = items.filter(
      (u) =>
        (!unreadOnly || u.unread > 0) &&
        `${u.name} ${u.nickname ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    );
    return contacts
      ? [...list].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
      : list;
  }, [items, unreadOnly, search, contacts]);

  useEffect(() => {
    const socket = io({
      auth: { portal: "support" },
      withCredentials: true,
      transports: ["websocket", "polling"],
    });
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", (error) => {
      setConnected(false);
      if (error.message === "SUPPORT_UNAUTHORIZED") expire();
    });
    socket.on("support:session-revoked", () => {
      expire();
      toast("客服登录已失效，请重新登录或联系管理员。", "error");
    });
    for (const event of [
      "message:new",
      "conversation:updated",
      "conversation:read",
      "customer:updated",
      "customer:bound",
    ]) {
      socket.on(event, () => {
        void client.invalidateQueries({ queryKey: ["support"] });
      });
    }
    return () => {
      socket.disconnect();
    };
  }, [client, expire, toast]);

  useEffect(() => {
    if (
      conversations.error instanceof ApiError &&
      conversations.error.status === 401
    )
      expire();
  }, [conversations.error, expire]);

  if (id && !selectedId) return <Navigate to="/support/chat" replace />;
  const leave = async () => {
    try {
      await logout();
      navigate("/support/login", { replace: true });
    } catch {
      toast("退出失败，请检查网络后重试。", "error");
    }
  };

  return (
    <div
      className={`support-desktop ${selectedId ? "has-conversation" : ""}`}
      style={viewport ? { height: viewport.height } : undefined}
    >
      <nav className="support-rail" aria-label="客服导航">
        <span className="support-rail-brand" title="iLink 客服">
          <Headphones size={25} />
        </span>
        <div className="support-rail-tabs">
          <button
            className={!contacts ? "active" : ""}
            onClick={() => {
              setContacts(false);
              setUnreadOnly(false);
            }}
            title="消息"
            aria-label="消息"
          >
            <MessageCircle size={25} />
            {unread ? <i>{unread > 99 ? "99+" : unread}</i> : null}
          </button>
          <button
            className={contacts ? "active" : ""}
            onClick={() => {
              setContacts(true);
              setUnreadOnly(false);
            }}
            title="客户通讯录"
            aria-label="客户通讯录"
          >
            <Users size={24} />
          </button>
        </div>
        <div className="support-rail-bottom">
          <span
            className={`support-connection-dot ${connected ? "online" : ""}`}
            title={connected ? "实时消息已连接" : "实时连接中断，正在重连"}
          />
          <button
            className="support-profile-button"
            aria-label="我的客服账号"
            onClick={() => setProfileOpen(!profileOpen)}
          >
            <Avatar name={agent?.name ?? "客服"} size={36} />
          </button>
          <button title="退出登录" aria-label="退出客服登录" onClick={leave}>
            <LogOut size={20} />
          </button>
        </div>
        {profileOpen ? (
          <div className="support-profile-popover">
            <strong>{agent?.name}</strong>
            <span>@{agent?.username}</span>
            <small>
              <i />
              客服账号 · 仅会话权限
            </small>
            <button onClick={leave}>
              <LogOut size={14} />
              退出登录
            </button>
          </div>
        ) : null}
      </nav>

      <aside className="support-conversations">
        <header>
          <div>
            <h1>{contacts ? "客户" : "消息"}</h1>
            <span>{items.length} 位客户</span>
          </div>
          <button
            className="support-icon-button"
            title="刷新会话"
            aria-label="刷新会话"
            onClick={() => conversations.refetch()}
          >
            <RefreshCw
              size={17}
              className={conversations.isFetching ? "spin" : ""}
            />
          </button>
        </header>
        <div className="support-search">
          <Search size={15} />
          <input
            placeholder="搜索客户"
            aria-label="搜索客户"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search ? (
            <button onClick={() => setSearch("")} aria-label="清空搜索">
              <X size={13} />
            </button>
          ) : null}
        </div>
        <div className="support-list-filters">
          <button
            className={!unreadOnly ? "active" : ""}
            onClick={() => setUnreadOnly(false)}
          >
            全部
          </button>
          <button
            className={unreadOnly ? "active" : ""}
            onClick={() => setUnreadOnly(true)}
          >
            未读{unread ? <span>{unread}</span> : null}
          </button>
          <span>团队共享会话</span>
        </div>
        <div className="support-conversation-scroll">
          {conversations.isPending ? (
            <div className="support-list-empty">
              <Loader2 size={23} className="spin" />
              正在加载会话…
            </div>
          ) : conversations.isError ? (
            <div className="support-list-empty">
              <WifiOff size={23} />
              <span>会话加载失败</span>
              <button onClick={() => conversations.refetch()}>重试</button>
            </div>
          ) : (
            filtered.map((user) => (
              <button
                key={user.id}
                className={`support-conversation-item ${selectedId === user.id ? "selected" : ""}`}
                onClick={() => navigate(`/support/chat/${user.id}`)}
              >
                <span className="support-list-avatar">
                  <Avatar src={user.avatar} name={user.name} size={43} />
                  {user.unread ? (
                    <i>{user.unread > 99 ? "99+" : user.unread}</i>
                  ) : null}
                </span>
                <span className="support-conversation-text">
                  <span>
                    <strong>{user.name}</strong>
                    <time>{shortTime(user.lastMessageAt ?? user.boundAt)}</time>
                  </span>
                  <span>
                    <small>
                      {user.lastMessageDirection === "outbound" ? "我：" : ""}
                      {user.lastMessage || "[图片 / 附件]"}
                    </small>
                    {remainingSeconds(user.windowExpiresAt, now) <= 0 ? (
                      <em>已关闭</em>
                    ) : user.replyRemaining <= 0 ? (
                      <em>待回复</em>
                    ) : null}
                  </span>
                </span>
              </button>
            ))
          )}
          {!conversations.isPending &&
          !conversations.isError &&
          !filtered.length ? (
            <div className="support-list-empty">
              <MessageCircle size={28} />
              <strong>
                {search
                  ? "没有找到客户"
                  : unreadOnly
                    ? "暂时没有未读消息"
                    : "暂无客户会话"}
              </strong>
              <small>
                {search
                  ? "试试客户姓名或备注"
                  : "客户绑定并发送消息后会显示在这里"}
              </small>
            </div>
          ) : null}
        </div>
        <footer>
          <span className={connected ? "connected" : ""}>
            <i />
            {connected ? "消息实时同步中" : "正在重新连接…"}
          </span>
          <span>iLink</span>
        </footer>
      </aside>

      {selectedId ? (
        <SupportConversation key={selectedId} userId={selectedId} />
      ) : (
        <section className="support-chat-welcome">
          <span>
            <MessageCircle size={60} strokeWidth={1.2} />
          </span>
          <h2>iLink 客服会话</h2>
          <p>选择一位客户，开始今天的对话</p>
          <small>文字、图片与文件，都在一个熟悉的聊天空间</small>
          <div>
            <Headphones size={15} />
            {agent?.name}，欢迎回来
          </div>
        </section>
      )}
    </div>
  );
}

function SupportConversation({ userId }: { userId: number }) {
  const { agent, expire } = useSupportAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const client = useQueryClient();
  const now = useNow();
  const [draft, setDraft] = useState("");
  const [media, setMedia] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [remark, setRemark] = useState("");
  const [jump, setJump] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const atBottom = useRef(true);
  const scrollRestore = useRef<{ height: number; top: number } | null>(null);
  const typingAt = useRef(0);
  const uploadBusy = useRef(false);
  const userQuery = useQuery({
    queryKey: ["support", agent?.id, "user", userId],
    queryFn: () => api<{ user: User }>(`/api/support/users/${userId}`),
    refetchInterval: 15_000,
  });
  const messages = useInfiniteQuery({
    queryKey: ["support", agent?.id, "messages", userId],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      api<MessagePage>(
        `/api/support/users/${userId}/messages?limit=40${pageParam ? `&beforeId=${pageParam}` : ""}`,
      ),
    getNextPageParam: (last) =>
      last.hasMore ? (last.nextBeforeId ?? undefined) : undefined,
    refetchInterval: 15_000,
  });
  const user = userQuery.data?.user;
  const rows = useMemo(
    () =>
      [...(messages.data?.pages ?? [])].reverse().flatMap((page) => page.items),
    [messages.data],
  );
  const lastId = rows.at(-1)?.id;
  const seconds = remainingSeconds(user?.windowExpiresAt ?? null, now);
  const unavailable =
    !user || user.accountStatus === "session_expired"
      ? "客户 ClawBot 已失效，请联系管理员安排重新绑定"
      : seconds <= 0
        ? "会话窗口已关闭，等待客户发来新消息后即可回复"
        : user.replyRemaining <= 0
          ? "本轮 10 条配额已用完，等待客户回复后自动恢复"
          : "";
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["support"] });
  };
  const handleError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) expire();
    else
      toast(
        error instanceof Error ? error.message : "操作失败，请重试。",
        "error",
      );
  };
  const send = useMutation({
    mutationFn: (input: { content: string; attachment: UploadResult | null }) =>
      api(`/api/support/users/${userId}/messages`, {
        method: "POST",
        json: {
          content: input.content,
          msgType: input.attachment
            ? input.attachment.isImage
              ? "image"
              : "file"
            : "text",
          mediaUrl: input.attachment?.url,
          mediaName: input.attachment?.name,
          mediaSize: input.attachment?.size,
          mediaMime: input.attachment?.mimeType,
        },
      }),
    onSuccess: () => {
      setDraft("");
      setMedia(null);
      setEmojiOpen(false);
      atBottom.current = true;
      refresh();
      textareaRef.current?.focus();
    },
    onError: (error) => {
      handleError(error);
      refresh();
    },
  });
  const editRemark = useMutation({
    mutationFn: () =>
      api(`/api/support/users/${userId}`, {
        method: "PATCH",
        json: { remark },
      }),
    onSuccess: () => {
      refresh();
      toast("客户备注已更新");
    },
    onError: handleError,
  });

  useEffect(() => {
    if (userQuery.error instanceof ApiError && userQuery.error.status === 401)
      expire();
  }, [userQuery.error, expire]);
  useEffect(() => {
    if (!lastId) return;
    void api(`/api/support/users/${userId}/read`, { method: "POST" })
      .then(() =>
        client.invalidateQueries({
          queryKey: ["support", agent?.id, "conversations"],
        }),
      )
      .catch(() => undefined);
  }, [userId, lastId, agent?.id, client]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (scrollRestore.current) {
      el.scrollTop =
        scrollRestore.current.top +
        el.scrollHeight -
        scrollRestore.current.height;
      scrollRestore.current = null;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    } else setJump(true);
  }, [lastId, rows.length]);
  useEffect(() => {
    const keepLatestVisible = () => {
      if (atBottom.current && scrollRef.current) {
        requestAnimationFrame(() => {
          if (scrollRef.current)
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        });
      }
    };
    window.visualViewport?.addEventListener("resize", keepLatestVisible);
    return () =>
      window.visualViewport?.removeEventListener("resize", keepLatestVisible);
  }, []);

  const upload = async (file?: File) => {
    if (!file || uploadBusy.current || unavailable || send.isPending) return;
    const isImage = file.type.startsWith("image/");
    if (file.size > (isImage ? 8 : 20) * 1024 * 1024) {
      toast(isImage ? "图片不能超过 8MB" : "文件不能超过 20MB", "error");
      return;
    }
    uploadBusy.current = true;
    setUploading(true);
    try {
      setMedia(await uploadFile(file, "/api/support/uploads"));
    } catch (error) {
      handleError(error);
    } finally {
      uploadBusy.current = false;
      setUploading(false);
    }
  };
  const chooseFile = (e: ChangeEvent<HTMLInputElement>) => {
    void upload(e.target.files?.[0]);
    e.target.value = "";
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const file = [...e.clipboardData.items]
      .find((item) => item.kind === "file")
      ?.getAsFile();
    if (file) {
      e.preventDefault();
      void upload(file);
    }
  };
  const submit = () => {
    if (unavailable || uploading || send.isPending || (!draft.trim() && !media))
      return;
    send.mutate({ content: draft.trim(), attachment: media });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  const type = (value: string) => {
    setDraft(value);
    if (Date.now() - typingAt.current > 4_000) {
      typingAt.current = Date.now();
      void api(`/api/support/users/${userId}/typing`, { method: "POST" }).catch(
        () => undefined,
      );
    }
  };

  if (userQuery.isPending)
    return (
      <section className="support-chat-welcome">
        <Loader2 size={26} className="spin" />
        <p>正在加载会话…</p>
      </section>
    );
  if (!user)
    return (
      <section className="support-chat-welcome">
        <WifiOff size={34} />
        <h2>暂时无法打开会话</h2>
        <p>
          {userQuery.error instanceof Error
            ? userQuery.error.message
            : "客户不存在或已解绑"}
        </p>
        <button className="support-primary" onClick={() => userQuery.refetch()}>
          重新加载
        </button>
        <button
          className="support-icon-button"
          onClick={() => navigate("/support/chat")}
        >
          返回会话列表
        </button>
      </section>
    );

  return (
    <section className="support-chat-area">
      <header className="support-chat-header">
        <button
          className="support-mobile-back support-icon-button"
          aria-label="返回会话列表"
          onClick={() => navigate("/support/chat")}
        >
          <ArrowLeft size={21} />
        </button>
        <div>
          <h2>
            {user.name}
            <span>微信客户</span>
          </h2>
          <p className={unavailable ? "closed" : ""}>
            <i />
            {unavailable ? "等待客户消息" : `窗口剩余 ${duration(seconds)}`}
            <span>·</span>本轮已用 {user.replyUsed}/{user.replyQuota} 条
          </p>
        </div>
        <button
          className={`support-icon-button ${infoOpen ? "active" : ""}`}
          aria-label="客户资料"
          title="客户资料"
          onClick={() => {
            setInfoOpen(!infoOpen);
            setRemark(user.remark || user.name);
          }}
        >
          <Info size={21} />
        </button>
      </header>
      <div className="support-chat-content">
        <div className="support-chat-body">
          <div
            className="support-messages"
            ref={scrollRef}
            onScroll={() => {
              const el = scrollRef.current;
              if (!el) return;
              atBottom.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 100;
              if (atBottom.current) setJump(false);
            }}
          >
            {messages.hasNextPage ? (
              <button
                className="support-load-history"
                disabled={messages.isFetchingNextPage}
                onClick={() => {
                  const el = scrollRef.current;
                  if (el)
                    scrollRestore.current = {
                      height: el.scrollHeight,
                      top: el.scrollTop,
                    };
                  void messages.fetchNextPage();
                }}
              >
                {messages.isFetchingNextPage ? (
                  <Loader2 size={13} className="spin" />
                ) : (
                  <ChevronDown size={13} />
                )}
                加载更早消息
              </button>
            ) : null}
            {messages.isError ? (
              <div className="support-list-empty">
                消息加载失败
                <button onClick={() => messages.refetch()}>重新加载</button>
              </div>
            ) : messages.isPending ? (
              <div className="support-list-empty">
                <Loader2 className="spin" size={20} />
              </div>
            ) : !rows.length ? (
              <div className="support-list-empty">
                <MessageCircle size={30} />
                <p>还没有聊天记录，向客户打个招呼吧。</p>
              </div>
            ) : (
              rows.map((message, index) => (
                <div key={message.id}>
                  {!rows[index - 1] ||
                  dayjs(message.sentAt).diff(
                    dayjs(rows[index - 1]!.sentAt),
                    "minute",
                  ) > 30 ? (
                    <div className="support-time-divider">
                      {dayjs(message.sentAt).format("M月D日 HH:mm")}
                    </div>
                  ) : null}
                  <SupportBubble
                    message={message}
                    user={user}
                    onImage={setLightbox}
                    onMediaLoad={() => {
                      if (atBottom.current && scrollRef.current)
                        scrollRef.current.scrollTop =
                          scrollRef.current.scrollHeight;
                    }}
                  />
                </div>
              ))
            )}
          </div>
          {jump ? (
            <button
              className="support-new-messages"
              onClick={() => {
                atBottom.current = true;
                scrollRef.current?.scrollTo({
                  top: scrollRef.current.scrollHeight,
                  behavior: "smooth",
                });
                setJump(false);
              }}
            >
              <ArrowDown size={13} />
              回到最新消息
            </button>
          ) : null}
          <footer
            className={`support-composer ${unavailable ? "unavailable" : ""}`}
          >
            <div className="support-composer-toolbar">
              <div>
                <button
                  className="support-icon-button"
                  title="表情"
                  aria-label="表情"
                  disabled={Boolean(unavailable)}
                  onClick={() => setEmojiOpen(!emojiOpen)}
                >
                  <Smile size={21} />
                </button>
                <button
                  className="support-icon-button"
                  title="发送图片"
                  aria-label="发送图片"
                  disabled={Boolean(unavailable) || uploading || send.isPending}
                  onClick={() => imageRef.current?.click()}
                >
                  <ImageIcon size={21} />
                </button>
                <button
                  className="support-icon-button"
                  title="发送文件"
                  aria-label="发送文件"
                  disabled={Boolean(unavailable) || uploading || send.isPending}
                  onClick={() => fileRef.current?.click()}
                >
                  <Paperclip size={21} />
                </button>
              </div>
              <span>
                {uploading ? (
                  <>
                    <Loader2 className="spin" size={13} />
                    附件上传中…
                  </>
                ) : unavailable ? (
                  "窗口受限"
                ) : (
                  <>
                    还可发送 <strong>{user.replyRemaining}</strong> 条
                  </>
                )}
              </span>
            </div>
            {emojiOpen ? (
              <div className="support-emoji-picker">
                {EMOJI.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      setDraft((value) => value + emoji);
                      setEmojiOpen(false);
                      textareaRef.current?.focus();
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}
            {media ? (
              <div className="support-attachment">
                {media.isImage ? (
                  <img src={media.url} alt="待发送图片" />
                ) : (
                  <FileText size={26} />
                )}
                <span>
                  <strong>{media.name}</strong>
                  <small>{bytes(media.size)}</small>
                </span>
                <button
                  className="support-icon-button"
                  aria-label="移除附件"
                  disabled={send.isPending}
                  onClick={() => setMedia(null)}
                >
                  <X size={15} />
                </button>
              </div>
            ) : null}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              ref={imageRef}
              onChange={chooseFile}
              hidden
            />
            <input type="file" ref={fileRef} onChange={chooseFile} hidden />
            <textarea
              ref={textareaRef}
              aria-label="消息内容"
              placeholder={unavailable || `发送消息给 ${user.name}…`}
              value={draft}
              onChange={(e) => type(e.target.value)}
              onPaste={onPaste}
              onKeyDown={onKey}
              disabled={Boolean(unavailable) || send.isPending}
              maxLength={30000}
            />
            <div className="support-composer-bottom">
              <span>
                {unavailable ||
                  (draft
                    ? `${new TextEncoder().encode(draft).length} 字节 · Enter 发送，Shift + Enter 换行`
                    : "Enter 发送，Shift + Enter 换行 · 支持粘贴图片")}
              </span>
              <button
                className="support-primary"
                onClick={submit}
                disabled={
                  Boolean(unavailable) ||
                  uploading ||
                  send.isPending ||
                  (!draft.trim() && !media)
                }
              >
                {send.isPending ? (
                  <Loader2 className="spin" size={15} />
                ) : (
                  <Send size={15} />
                )}
                {send.isPending ? "发送中" : "发送"}
              </button>
            </div>
          </footer>
        </div>
        {infoOpen ? (
          <aside className="support-customer-info">
            <button
              className="support-icon-button support-info-close"
              onClick={() => setInfoOpen(false)}
              aria-label="关闭客户资料"
            >
              <X size={17} />
            </button>
            <Avatar src={user.avatar} name={user.name} size={66} />
            <h3>{user.name}</h3>
            <span>微信客户</span>
            <dl>
              <dt>绑定时间</dt>
              <dd>{fullTime(user.boundAt)}</dd>
              <dt>最近活跃</dt>
              <dd>{fullTime(user.lastActiveAt)}</dd>
              <dt>本轮消息配额</dt>
              <dd>
                {user.replyUsed} / {user.replyQuota}
              </dd>
            </dl>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                editRemark.mutate();
              }}
            >
              <label>
                客户备注
                <input
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  maxLength={30}
                  required
                />
              </label>
              <button
                className="support-primary"
                disabled={editRemark.isPending || !remark.trim()}
              >
                <Check size={14} />
                保存备注
              </button>
            </form>
            <p>客户每次发来新消息，会同时重置 24 小时窗口和 10 条回复配额。</p>
          </aside>
        ) : null}
      </div>
      <Modal
        open={Boolean(lightbox)}
        title="查看图片"
        onClose={() => setLightbox(null)}
        width={850}
      >
        {lightbox ? (
          <img className="support-lightbox" src={lightbox} alt="聊天图片原图" />
        ) : null}
      </Modal>
    </section>
  );
}
