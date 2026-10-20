import { useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Check,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { api, uploadFile, type UploadResult } from "../api";
import { dayjs } from "../lib/format";
import { useToast } from "../store/ToastContext";

interface Schedule {
  id: number;
  cron_expr: string;
  message: string;
  media_type: "text" | "image" | "file";
  media_url: string | null;
  media_name: string | null;
  enabled: number;
  only_if_active: number;
  created_at: string;
}

interface ScheduleResponse {
  items: Schedule[];
  runs: Array<{
    id: number;
    schedule_id: number | null;
    triggered_at: string;
    sent_count: number;
    skip_count: number;
  }>;
}

export function KeepaliveSchedulePanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [cronExpr, setCronExpr] = useState("0 10 * * *");
  const [message, setMessage] = useState(
    "您好{nickname_suffix}，今天有任何问题都可以随时告诉我们～",
  );
  const [mediaType, setMediaType] = useState<"text" | "image" | "file">("text");
  const [media, setMedia] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["keepalive-schedules"],
    queryFn: () => api<ScheduleResponse>("/api/keepalive/schedules"),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["keepalive-schedules"] });
    queryClient.invalidateQueries({ queryKey: ["keepalive"] });
  };

  const create = useMutation({
    mutationFn: () =>
      api("/api/keepalive/schedules", {
        method: "POST",
        json: {
          cronExpr,
          message,
          mediaType,
          mediaUrl: media?.url ?? null,
          mediaName: media?.name ?? null,
          enabled: true,
          onlyIfActive: true,
        },
      }),
    onSuccess: () => {
      toast("定时保活已创建");
      setMedia(null);
      setMediaType("text");
      refresh();
    },
    onError: (error) => toast(error instanceof Error ? error.message : "创建失败", "error"),
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      api(`/api/keepalive/schedules/${id}`, { method: "PATCH", json: { enabled } }),
    onSuccess: refresh,
    onError: (error) => toast(error instanceof Error ? error.message : "更新失败", "error"),
  });

  const remove = useMutation({
    mutationFn: (id: number) =>
      api(`/api/keepalive/schedules/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast("定时任务已删除");
      refresh();
    },
    onError: (error) => toast(error instanceof Error ? error.message : "删除失败", "error"),
  });

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadFile(file);
      setMedia(result);
      setMediaType(result.isImage ? "image" : "file");
    } catch (error) {
      toast(error instanceof Error ? error.message : "上传失败", "error");
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="card panel schedule-panel">
      <div className="panel-head">
        <div>
          <h3>定时保活</h3>
          <p>按固定 cron 时间向有效窗口客户发送保活消息，可配置多个时间点</p>
        </div>
        <CalendarClock size={18} className="panel-soft-icon" />
      </div>

      <div className="schedule-form">
        <label>
          <span>cron 表达式</span>
          <input
            value={cronExpr}
            onChange={(event) => setCronExpr(event.target.value)}
            placeholder="0 10 * * *"
          />
          <small>标准 5 字段，例如 `0 10 * * *` 表示每天 10:00</small>
        </label>
        <div className="schedule-type-row">
          <label className="select-wrap full">
            <select
              value={mediaType}
              onChange={(event) =>
                setMediaType(event.target.value as "text" | "image" | "file")
              }
            >
              <option value="text">文本保活</option>
              <option value="image">图片保活</option>
              <option value="file">文件保活</option>
            </select>
          </label>
          {mediaType === "image" || mediaType === "file" ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept={mediaType === "image" ? "image/*" : undefined}
                hidden
                onChange={upload}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 size={14} className="spin" />
                ) : mediaType === "image" ? (
                  <ImageIcon size={14} />
                ) : (
                  <FileText size={14} />
                )}
                {media ? "更换附件" : mediaType === "image" ? "上传图片" : "上传文件"}
              </button>
              {media?.isImage ? (
                <img className="schedule-thumb" src={media.url} alt="保活图片" />
              ) : null}
              {media && !media.isImage ? (
                <span className="schedule-file-name">{media.name}</span>
              ) : null}
            </>
          ) : null}
        </div>
        <label>
          <span>保活文案</span>
          <textarea
            rows={3}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={500}
            placeholder="支持 {nickname} 变量"
          />
        </label>
        <button
          type="button"
          className="btn btn-primary btn-sm schedule-add"
          onClick={() => create.mutate()}
          disabled={create.isPending || !cronExpr.trim() || !message.trim()}
        >
          {create.isPending ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
          添加定时任务
        </button>
      </div>

      <div className="schedule-list">
        {isLoading ? (
          <div className="run-empty"><Loader2 size={16} className="spin" /> 加载中</div>
        ) : data?.items.length ? (
          data.items.map((item) => (
            <div className="schedule-item" key={item.id}>
              <button
                type="button"
                className={`schedule-check ${item.enabled ? "on" : ""}`}
                onClick={() => toggle.mutate({ id: item.id, enabled: !item.enabled })}
                title={item.enabled ? "点击暂停" : "点击启用"}
              >
                {item.enabled ? <Check size={12} /> : null}
              </button>
              <div className="schedule-main">
                <strong>
                  <code>{item.cron_expr}</code>
                  <em>
                    {item.media_type === "image"
                      ? "图片"
                      : item.media_type === "file"
                        ? "文件"
                        : "文本"}
                  </em>
                </strong>
                <span>{item.message}</span>
              </div>
              <button
                type="button"
                className="icon-btn tiny"
                onClick={() => remove.mutate(item.id)}
                title="删除"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        ) : (
          <div className="run-empty">还没有定时保活任务</div>
        )}
      </div>

      {data?.runs.length ? (
        <div className="schedule-runs">
          <span>最近触发</span>
          {data.runs.slice(0, 3).map((run) => (
            <div key={run.id}>
              <time>{dayjs(run.triggered_at).format("MM/DD HH:mm")}</time>
              <em>成功 {run.sent_count} · 跳过 {run.skip_count}</em>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
