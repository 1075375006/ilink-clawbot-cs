import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Check,
  ChevronDown,
  Clock3,
  Info,
  Loader2,
  Moon,
  Play,
  Save,
  Sparkles,
} from "lucide-react";
import { api } from "../api";
import type { KeepaliveData } from "../types";
import { dayjs, fromNow } from "../lib/format";
import { PageSkeleton } from "../components/Skeleton";
import { Modal } from "../components/Modal";
import { useToast } from "../store/ToastContext";

interface RunResult {
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

function renderPreview(template: string, name: string): string {
  return template
    .replaceAll("{nickname}", name)
    .replaceAll("{nickname_suffix}", `，${name}`)
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function KeepalivePage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["keepalive"],
    queryFn: () => api<KeepaliveData>("/api/keepalive"),
  });
  const [enabled, setEnabled] = useState(true);
  const [threshold, setThreshold] = useState(20);
  const [template, setTemplate] = useState("");
  const [maxPerDay, setMaxPerDay] = useState(1);
  const [quotaWarnAt, setQuotaWarnAt] = useState(1);
  const [silentStart, setSilentStart] = useState("23:00");
  const [silentEnd, setSilentEnd] = useState("08:00");
  const [dirty, setDirty] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [templateError, setTemplateError] = useState("");

  useEffect(() => {
    if (!data) return;
    setEnabled(Boolean(data.config.enabled));
    setThreshold(data.config.threshold_hours);
    setTemplate(data.config.msg_template);
    setMaxPerDay(data.config.max_per_day);
    setQuotaWarnAt(data.config.quota_warn_at ?? 1);
    setSilentStart(data.config.silent_start);
    setSilentEnd(data.config.silent_end);
    setDirty(false);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api<{ config: KeepaliveData["config"] }>("/api/keepalive/config", {
        method: "PUT",
        json: {
          enabled,
          thresholdHours: threshold,
          msgTemplate: template,
          maxPerDay,
          quotaWarnAt,
          silentStart,
          silentEnd,
        },
      }),
    onSuccess: () => {
      setDirty(false);
      toast("保活设置已保存");
      queryClient.invalidateQueries({ queryKey: ["keepalive"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "保存失败", "error"),
  });

  const runMutation = useMutation({
    mutationFn: () =>
      api<RunResult>("/api/keepalive/run", {
        method: "POST",
        json: { dryRun: false },
      }),
    onSuccess: (result) => {
      setRunResult(result);
      setRunOpen(true);
      queryClient.invalidateQueries({ queryKey: ["keepalive"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      toast(
        result.silent
          ? "当前处于静默时段，消息将在结束后补发"
          : `检查完成：命中 ${result.eligible} 位，送达 ${result.sent} 位`,
        result.failed ? "info" : "success",
      );
    },
    onError: (error) => toast(error instanceof Error ? error.message : "执行失败", "error"),
  });

  const preview = useMemo(() => renderPreview(template, "林薇"), [template]);
  const charCount = template.length;

  if (isLoading || !data) return <PageSkeleton />;

  const validateTemplate = (value: string) => {
    if (!value.trim()) return "保活文案不能为空。";
    if (/(https?:\/\/|www\.)/i.test(value)) return "保活文案不能包含外部链接，避免触发平台审核。";
    return "";
  };

  const updateTemplate = (value: string) => {
    setTemplate(value);
    setDirty(true);
    setTemplateError(validateTemplate(value));
  };

  const insertVariable = (variable: string) => {
    updateTemplate(`${template}${template && !template.endsWith(" ") ? " " : ""}${variable}`);
  };

  const disabledSave = !dirty || Boolean(templateError) || saveMutation.isPending;

  return (
    <div className="page-enter">
      <div className="page-heading-row">
        <div>
          <h2 className="page-title">把对话留在窗口里</h2>
          <p className="page-sub">在客户最后发言 24 小时窗口关闭前，用一条自然的问候重新建立联系。</p>
        </div>
        <div className="heading-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
          >
            {runMutation.isPending ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
            立即执行检查
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={disabledSave}
            onClick={() => {
              const error = validateTemplate(template);
              if (error) {
                setTemplateError(error);
                return;
              }
              saveMutation.mutate();
            }}
          >
            {saveMutation.isPending ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
            保存设置
          </button>
        </div>
      </div>

      <div className="keepalive-layout">
        <div className="keepalive-main">
          <section className="card panel">
            <div className="panel-head">
              <div>
                <h3>保活策略</h3>
                <p>关闭后将停止所有自动保活消息</p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => {
                    setEnabled(event.target.checked);
                    setDirty(true);
                  }}
                />
                <span />
              </label>
            </div>
            <div className={`keepalive-status-strip ${enabled ? "on" : "off"}`}>
              <span className="status-dot online" />
              <div>
                <strong>{enabled ? "保活运行中" : "保活已暂停"}</strong>
                <p>
                  {enabled
                    ? `每 5 分钟检查一次：超过 ${threshold} 小时，或剩余 ${quotaWarnAt} 条配额时触发。`
                    : "开启后系统会按下方策略自动触达客户。"}
                </p>
              </div>
              <span className="cron-chip">*/5 * * * *</span>
            </div>

            <div className="form-section">
              <label className="field-label">
                触发阈值
                <span className="field-help">距客户最后一次发言多久后触发，建议 18–22 小时</span>
              </label>
              <div className="range-row">
                <input
                  type="range"
                  min={1}
                  max={23}
                  value={threshold}
                  style={{
                    background: `linear-gradient(90deg, #2E86AB 0%, #2E86AB ${
                      ((threshold - 1) / 22) * 100
                    }%, #e8edf4 ${((threshold - 1) / 22) * 100}%)`,
                  }}
                  onChange={(event) => {
                    setThreshold(Number(event.target.value));
                    setDirty(true);
                  }}
                />
                <div className="number-box">
                  <input
                    type="number"
                    min={1}
                    max={23}
                    value={threshold}
                    onChange={(event) => {
                      const value = Math.max(1, Math.min(23, Number(event.target.value) || 1));
                      setThreshold(value);
                      setDirty(true);
                    }}
                  />
                  <span>小时</span>
                </div>
              </div>
              <div className="range-scale">
                <span>1h</span>
                <span>12h</span>
                <span>23h</span>
              </div>
            </div>

            <div className="form-section">
              <div className="quota-warn-row">
                <label className="field-label">
                  消息配额预警触发
                  <span className="field-help">
                    距 10 条上限仅剩 N 条时额外触发一次保活，范围 1–3 条
                  </span>
                </label>
                <div className="number-box">
                  <input
                    type="number"
                    min={1}
                    max={3}
                    value={quotaWarnAt}
                    onChange={(event) => {
                      const value = Math.max(1, Math.min(3, Number(event.target.value) || 1));
                      setQuotaWarnAt(value);
                      setDirty(true);
                    }}
                  />
                  <span>条</span>
                </div>
              </div>
            </div>

            <div className="form-section">
              <label className="field-label">
                保活消息内容
                <span className="field-help">支持 {"{nickname}"} 变量，内容会以纯文本发送</span>
              </label>
              <div className="template-wrap">
                <textarea
                  value={template}
                  onChange={(event) => updateTemplate(event.target.value)}
                  maxLength={500}
                  rows={4}
                  className={templateError ? "invalid" : ""}
                />
                <div className="template-tools">
                  <div className="var-chips">
                    <button type="button" onClick={() => insertVariable("{nickname}")}>
                      + 昵称
                    </button>
                  </div>
                  <span className={charCount > 480 ? "needs-care" : ""}>{charCount}/500</span>
                </div>
              </div>
              {templateError ? <div className="field-error">{templateError}</div> : null}
              <div className="preset-row">
                <span>快捷模板</span>
                {data.presets.map((preset) => (
                  <button
                    type="button"
                    key={preset.id}
                    className={`preset-chip ${template === preset.content ? "active" : ""}`}
                    onClick={() => updateTemplate(preset.content)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <details className="advanced-settings">
              <summary>
                高级设置
                <span>每日次数与静默时段</span>
              </summary>
              <div className="form-grid">
                <div className="form-section">
                <label className="field-label">
                  每日最大触发次数
                  <span className="field-help">避免频繁打扰同一位客户</span>
                </label>
                <label className="select-wrap full">
                  <select
                    value={maxPerDay}
                    onChange={(event) => {
                      setMaxPerDay(Number(event.target.value));
                      setDirty(true);
                    }}
                  >
                    {[1, 2, 3, 4, 5].map((value) => (
                      <option value={value} key={value}>
                        {value} 次 / 用户 / 天
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={15} className="select-chevron" />
                </label>
                </div>
                <div className="form-section">
                <label className="field-label">
                  静默时段
                  <span className="field-help">该时段不发送，结束后自动补发</span>
                </label>
                <div className="time-range">
                  <label>
                    <Clock3 size={15} />
                    <input
                      type="time"
                      value={silentStart}
                      onChange={(event) => {
                        setSilentStart(event.target.value);
                        setDirty(true);
                      }}
                    />
                  </label>
                  <span>至</span>
                  <label>
                    <Clock3 size={15} />
                    <input
                      type="time"
                      value={silentEnd}
                      onChange={(event) => {
                        setSilentEnd(event.target.value);
                        setDirty(true);
                      }}
                    />
                  </label>
                </div>
                </div>
              </div>
            </details>

            <div className="form-foot">
              <span className={dirty ? "dirty-hint" : "saved-hint"}>
                {dirty ? "有未保存的修改" : "所有修改已保存"}
              </span>
              <button
                type="button"
                className="btn btn-primary"
                disabled={disabledSave}
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                保存设置
              </button>
            </div>
          </section>
        </div>

        <aside className="keepalive-side">
          <section className="card panel preview-panel">
            <div className="panel-head">
              <div>
                <h3>发送预览</h3>
                <p>客户在 ClawBot 中看到的样子</p>
              </div>
              <span className="phone-tag">ClawBot</span>
            </div>
            <div className="phone-preview">
              <div className="phone-top">
                <span className="phone-avatar"><Sparkles size={14} /></span>
                <div>
                  <strong>iLink 客服助手</strong>
                  <small>在线</small>
                </div>
              </div>
              <div className="phone-body">
                <div className="phone-bubble">{preview || "保活文案会显示在这里"}</div>
                <span className="phone-time">{dayjs().format("HH:mm")}</span>
              </div>
            </div>
            <div className="preview-note">
              <Info size={14} />
              文案保持自然、不强迫，避免让客户感到被打扰。
            </div>
          </section>

          <section className="card panel status-panel">
            <div className="panel-head">
              <div>
                <h3>今日运行状态</h3>
                <p>{data.today}</p>
              </div>
              <span className="status-dot online" />
            </div>
            <div className="mini-stats">
              <div>
                <span>今日已发送</span>
                <strong>{data.todaySent}</strong>
              </div>
              <div>
                <span>待触发候选</span>
                <strong>{data.candidates}</strong>
              </div>
            </div>
            <div className="run-meta">
              <Clock3 size={14} />
              <span>上次运行：{data.lastRunAt ? fromNow(data.lastRunAt) : "尚未运行"}</span>
            </div>
            <div className="policy-list">
              <div><Check size={14} /> 仅向窗口仍有效的客户发送</div>
              <div><Check size={14} /> 剩余 {quotaWarnAt} 条配额时提前保活</div>
              <div><Check size={14} /> 同一窗口只发送一次</div>
              <div><Check size={14} /> 静默时段自动顺延</div>
              <div><Check size={14} /> 不包含任何外部跳转链接</div>
            </div>
          </section>

          <section className="card panel insight-panel">
            <span className="insight-icon"><Moon size={18} /></span>
            <div>
              <strong>关于静默时段</strong>
              <p>
                当前设置为 {silentStart}–{silentEnd}。若命中客户时正处于静默期，系统会在结束后重新检查；
                如果窗口已关闭，则不会再尝试发送。
              </p>
            </div>
          </section>
        </aside>
      </div>

      <Modal
        open={runOpen}
        title={runResult?.silent ? "已进入静默时段" : "保活检查完成"}
        description={
          runResult
            ? `检查 ${runResult.checked} 位客户，命中 ${runResult.eligible} 位`
            : undefined
        }
        onClose={() => setRunOpen(false)}
        width={560}
        footer={
          <button type="button" className="btn btn-primary" onClick={() => setRunOpen(false)}>
            知道了
          </button>
        }
      >
        {runResult ? (
          <div className="run-result">
            <div className="run-result-stats">
              <span><strong>{runResult.sent}</strong><em>已发送</em></span>
              <span><strong>{runResult.failed}</strong><em>失败</em></span>
              <span><strong>{runResult.deferred}</strong><em>静默顺延</em></span>
            </div>
            {runResult.silent ? (
              <div className="run-banner">
                <Moon size={16} />
                当前处于静默时段，本次没有发送消息，将在结束后补发。
              </div>
            ) : null}
            <div className="run-details">
              {runResult.details.length ? (
                runResult.details.map((item) => (
                  <div key={item.userId}>
                    <span>{item.name}</span>
                    <em className={item.status}>
                      {item.status === "sent"
                        ? "已发送"
                        : item.status === "failed"
                          ? item.reason
                          : item.status === "deferred"
                            ? "静默顺延"
                            : "已跳过"}
                    </em>
                  </div>
                ))
              ) : (
                <div className="run-empty">
                  <Activity size={18} />
                  暂时没有需要触发的客户
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
