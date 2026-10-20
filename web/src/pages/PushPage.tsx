import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Clock3,
  History,
  Image as ImageIcon,
  Loader2,
  Search,
  Send,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { api, uploadImage } from "../api";
import type { PushPreview, User } from "../types";
import { dayjs, fromNow } from "../lib/format";
import { remainingSeconds, useNow } from "../lib/useNow";
import { Avatar } from "../components/Avatar";
import { EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import { useToast } from "../store/ToastContext";

interface ConversationsResponse {
  items: User[];
}

interface PushResult {
  campaignId: number;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  results: Array<{
    userId: number;
    name: string;
    status: "sent" | "failed" | "skipped";
    reason?: string;
  }>;
}

interface PushHistoryItem {
  id: number;
  content: string;
  msgType: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  createdAt: string;
}

export function PushPage() {
  const { toast } = useToast();
  const now = useNow(30_000);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [msgType, setMsgType] = useState<"text" | "image">("text");
  const [content, setContent] = useState("");
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<PushResult | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api<ConversationsResponse>("/api/conversations"),
  });

  const history = useQuery({
    queryKey: ["push-history"],
    queryFn: () => api<{ items: PushHistoryItem[] }>("/api/push/history"),
  });

  const users = conversations.data?.items ?? [];
  const filtered = useMemo(
    () => (search.trim() ? users.filter((user) => user.name.includes(search.trim())) : users),
    [users, search],
  );
  const preview = useQuery({
    queryKey: ["push-preview", [...selected].sort((a, b) => a - b)],
    queryFn: () =>
      api<PushPreview>("/api/push/preview", {
        method: "POST",
        json: { userIds: [...selected] },
      }),
    enabled: selected.size > 0,
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      api<PushResult>("/api/push", {
        method: "POST",
        json: {
          userIds: [...selected],
          content: content.trim(),
          msgType,
          mediaUrl,
        },
      }),
    onSuccess: (data) => {
      setConfirmOpen(false);
      setResult(data);
      setSelected(new Set());
      setContent("");
      setMediaUrl(null);
      setMsgType("text");
      history.refetch();
      toast(`推送已执行：成功 ${data.sent} 位`, data.failed ? "info" : "success");
    },
    onError: (error) => toast(error instanceof Error ? error.message : "推送失败", "error"),
  });

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
      toast("仅支持 PNG / JPG / WEBP / GIF 图片", "error");
      return;
    }
    setUploading(true);
    try {
      const data = await uploadImage(file);
      setMediaUrl(data.url);
    } catch (error) {
      toast(error instanceof Error ? error.message : "上传失败", "error");
    } finally {
      setUploading(false);
    }
  };

  const toggle = (id: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const validFiltered = filtered.filter(
    (user) => remainingSeconds(user.windowExpiresAt, now) > 0 && user.replyRemaining > 0,
  );
  const allFilteredSelected =
    validFiltered.length > 0 && validFiltered.every((user) => selected.has(user.id));
  const toggleAll = () => {
    setSelected((current) => {
      const next = new Set(current);
      if (allFilteredSelected) validFiltered.forEach((user) => next.delete(user.id));
      else validFiltered.forEach((user) => next.add(user.id));
      return next;
    });
  };

  const canSend =
    selected.size > 0 &&
    (msgType === "text" ? content.trim().length > 0 : Boolean(mediaUrl)) &&
    !sendMutation.isPending;
  const contentBytes = new TextEncoder().encode(content).length;
  const contentSegments = Math.max(1, Math.ceil(contentBytes / 16384));

  return (
    <div className="page-enter">
      <div className="page-heading-row">
        <div>
          <h2 className="page-title">主动触达</h2>
          <p className="page-sub">选择客户、写好内容，把重要信息在会话窗口内送达。</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => setHistoryOpen(true)}>
          <History size={16} />
          推送记录
        </button>
      </div>

      <div className="push-layout">
        <section className="card push-recipients">
          <div className="panel-head">
            <div>
              <h3>选择收件人</h3>
              <p>已绑定客户 · {users.length} 位</p>
            </div>
            <button type="button" className="text-link" onClick={toggleAll}>
              {allFilteredSelected ? "取消全选" : "全选有效窗口用户"}
            </button>
          </div>
          <div className="chat-search push-search">
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索客户昵称"
            />
          </div>
          <div className="recipient-scroll">
            {filtered.map((user) => {
              const seconds = remainingSeconds(user.windowExpiresAt, now);
              const reachable = seconds > 0 && user.replyRemaining > 0;
              const checked = selected.has(user.id);
              return (
                <label key={user.id} className={`recipient-row ${checked ? "checked" : ""}`}>
                  <span className={`checkbox ${checked ? "on" : ""}`}>
                    {checked ? <Check size={13} strokeWidth={3} /> : null}
                    <input type="checkbox" checked={checked} onChange={() => toggle(user.id)} />
                  </span>
                  <Avatar src={user.avatar} name={user.name} size={38} />
                  <span className="recipient-main">
                    <strong>{user.name}</strong>
                    <small>{fromNow(user.lastActiveAt)}活跃</small>
                  </span>
                  <span className={`reach-dot ${reachable ? "ok" : "no"}`} title={reachable ? "可送达" : "不可送达"} />
                </label>
              );
            })}
            {!filtered.length ? (
              <EmptyState
                icon={<Users size={20} />}
                title={search ? "没有匹配客户" : "还没有客户"}
                description={search ? "换个名字试试" : "客户完成绑定后即可推送"}
              />
            ) : null}
          </div>
          <div className="recipient-foot">
            <span>
              已选 {selected.size} 人 / 其中有效窗口 {preview.data?.reachable ?? 0} 人
            </span>
            {selected.size ? (
              <button type="button" className="text-link" onClick={() => setSelected(new Set())}>
                清空
              </button>
            ) : null}
          </div>
        </section>

        <section className="card push-editor">
          <div className="panel-head">
            <div>
              <h3>编辑消息</h3>
              <p>内容会在所选客户的 ClawBot 窗口中展示</p>
            </div>
            <span className="draft-state">
              <span className="status-dot online" />
              实时校验窗口
            </span>
          </div>

          <div className="segmented">
            <button
              type="button"
              className={msgType === "text" ? "active" : ""}
              onClick={() => setMsgType("text")}
            >
              <Sparkles size={15} /> 文本消息
            </button>
            <button
              type="button"
              className={msgType === "image" ? "active" : ""}
              onClick={() => setMsgType("image")}
            >
              <ImageIcon size={15} /> 图片消息
            </button>
          </div>

          {msgType === "image" ? (
            <div className="push-image-area">
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={upload} />
              {mediaUrl ? (
                <div className="push-image-preview">
                  <img src={mediaUrl} alt="待发送图片" />
                  <button type="button" onClick={() => setMediaUrl(null)} aria-label="移除图片">
                    <X size={15} />
                  </button>
                </div>
              ) : (
                <button type="button" className="upload-drop" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? <Loader2 size={22} className="spin" /> : <ImageIcon size={22} />}
                  <strong>{uploading ? "正在上传…" : "点击上传图片"}</strong>
                  <span>PNG / JPG / WEBP，最大 8MB</span>
                </button>
              )}
            </div>
          ) : null}

          <div className="push-textarea">
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              maxLength={30000}
              placeholder={
                msgType === "image"
                  ? "可添加图片说明（可选）"
                  : "输入推送内容，例如：本周会员日，满 300 减 50，今晚 8 点开始～"
              }
              rows={7}
            />
            <span className="char-count">
              {contentBytes} 字节 · {contentSegments} 段
            </span>
          </div>

          <div className="push-summary">
            <div>
              <span className="summary-icon">
                <Clock3 size={15} />
              </span>
              <span>
                当前有效窗口用户数{" "}
                <strong>{preview.data?.reachable ?? 0}</strong> / 共选{" "}
                <strong>{selected.size}</strong>
              </span>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-send"
              disabled={!canSend}
              onClick={() => setConfirmOpen(true)}
            >
              {sendMutation.isPending ? <Loader2 size={17} className="spin" /> : <Send size={17} />}
              发送推送
            </button>
          </div>

          <div className="push-tip">
            <AlertTriangle size={14} />
            主动消息同时受 24 小时窗口与 10 条配额限制，已关闭或配额不足的客户会自动跳过。
          </div>
          {sendMutation.isPending ? (
            <div className="push-progress-wrap" aria-label="正在发送">
              <div className="push-progress"><i /></div>
              <span>正在逐位发送，请稍候…</span>
            </div>
          ) : null}
        </section>
      </div>

      <Modal
        open={confirmOpen}
        title="确认发送推送"
        description={`将向 ${selected.size} 位客户发送${msgType === "image" ? "一条图片消息" : `一条文本消息（${contentSegments} 段）`}，其中 ${
          preview.data?.unreachable ?? 0
        } 位窗口已关闭或配额不足将跳过`}
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmOpen(false)}>
              再检查一下
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={sendMutation.isPending}
              onClick={() => sendMutation.mutate()}
            >
              {sendMutation.isPending ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
              确认发送
            </button>
          </>
        }
      >
        <div className="confirm-body">
          <div className="confirm-stats">
            <span className="ok">
              <strong>{preview.data?.reachable ?? 0}</strong>
              可送达
            </span>
            <span className="no">
              <strong>{preview.data?.unreachable ?? 0}</strong>
              无法送达
            </span>
          </div>
          {preview.data?.unreachable ? (
            <div className="unreachable-list">
              <p>以下客户将跳过，不会收到这条消息：</p>
              {preview.data.items
                .filter((item) => !item.reachable)
                .slice(0, 6)
                .map((item) => (
                  <div key={item.userId}>
                    <Avatar src={item.avatar} name={item.name} size={28} />
                    <span>{item.name}</span>
                    <em>{item.reason}</em>
                  </div>
                ))}
              {preview.data.unreachable > 6 ? <small>…以及其他 {preview.data.unreachable - 6} 位</small> : null}
            </div>
          ) : (
            <div className="all-reachable">
              <Check size={18} /> 所有已选客户都在有效会话窗口内
            </div>
          )}
          <div className="confirm-preview">
            <span>消息预览</span>
            {mediaUrl ? <img src={mediaUrl} alt="推送图片" /> : null}
            <p>{content.trim() || "（仅发送图片）"}</p>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(result)}
        title="推送完成"
        description="消息已逐条处理，结果如下"
        onClose={() => setResult(null)}
        footer={
          <button type="button" className="btn btn-primary" onClick={() => setResult(null)}>
            知道了
          </button>
        }
      >
        {result ? (
          <div className="result-body">
            <div className="result-big">
              <span className="result-check">
                <Check size={24} />
              </span>
              <div>
                <strong>{result.sent}</strong>
                <span>条消息已送达</span>
              </div>
            </div>
            <div className="result-grid">
              <span><em>成功</em><strong>{result.sent}</strong></span>
              <span><em>失败</em><strong>{result.failed}</strong></span>
              <span><em>跳过</em><strong>{result.skipped}</strong></span>
            </div>
            <div className="result-list">
              {result.results.map((item) => (
                <div key={item.userId}>
                  <span>{item.name}</span>
                  <em className={item.status}>
                    {item.status === "sent" ? "已送达" : item.status === "failed" ? item.reason : item.reason}
                  </em>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={historyOpen}
        title="推送记录"
        description="最近的主动触达任务"
        onClose={() => setHistoryOpen(false)}
        width={620}
      >
        <div className="history-list">
          {history.data?.items.length ? (
            history.data.items.map((item) => (
              <div className="history-row" key={item.id}>
                <span className="history-icon"><Send size={15} /></span>
                <div>
                  <strong>{item.content || "（图片消息）"}</strong>
                  <small>
                    {dayjs(item.createdAt).format("M 月 D 日 HH:mm")} · 共 {item.total} 位
                  </small>
                </div>
                <span className="history-stats">
                  <em>{item.sent} 成功</em>
                  {item.failed ? <em className="bad">{item.failed} 失败</em> : null}
                  {item.skipped ? <em>{item.skipped} 跳过</em> : null}
                </span>
              </div>
            ))
          ) : (
            <EmptyState
              icon={<History size={20} />}
              title="还没有推送记录"
              description="发送第一条主动消息后会记录在这里。"
            />
          )}
        </div>
      </Modal>
    </div>
  );
}
