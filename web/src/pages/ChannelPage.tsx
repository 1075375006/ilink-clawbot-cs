import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Database,
  MessageCircle,
  QrCode,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { ChannelStatus } from "../types";
import { fullTime } from "../lib/format";
import { PageSkeleton } from "../components/Skeleton";
import { useToast } from "../store/ToastContext";

export function ChannelPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: channel, isLoading } = useQuery({
    queryKey: ["channel"],
    queryFn: () => api<ChannelStatus>("/api/channel"),
    refetchInterval: 15_000,
  });

  const modeMutation = useMutation({
    mutationFn: (mode: "demo" | "live") =>
      api<ChannelStatus>("/api/channel/mode", { method: "POST", json: { mode } }),
    onSuccess: (data) => {
      queryClient.setQueryData(["channel"], data);
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast(data.mode === "demo" ? "已切换到演示通道" : "已切换到真实 iLink 通道");
    },
    onError: (error) => toast(error instanceof Error ? error.message : "切换失败", "error"),
  });

  if (isLoading || !channel) return <PageSkeleton />;
  const isLive = channel.mode === "live";
  const userBots = channel.userBots ?? 0;

  return (
    <div className="page-enter">
      <div className="page-heading-row">
        <div>
          <h2 className="page-title">通道状态</h2>
          <p className="page-sub">每位客户独立扫码绑定，系统按客户维护 iLink Bot 连接与消息游标。</p>
        </div>
        <div className="heading-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["channel"] })}
          >
            <RefreshCw size={16} /> 刷新状态
          </button>
          <Link to="/invite" className="btn btn-primary">
            <QrCode size={16} /> 生成绑定二维码
          </Link>
        </div>
      </div>

      <section className="channel-hero card">
        <div className="channel-hero-left">
          <span className={`channel-hero-orb ${isLive && userBots === 0 ? "" : "online"}`}>
            {isLive && userBots === 0 ? <WifiOff size={26} /> : <Wifi size={26} />}
          </span>
          <div>
            <span className="channel-state-label">
              <span className={`status-dot ${isLive && userBots === 0 ? "offline" : "online"}`} />
              {isLive
                ? userBots > 0
                  ? `${userBots} 个客户 Bot 运行中`
                  : "等待客户扫码接入"
                : "演示通道运行中"}
            </span>
            <h3>{isLive ? "真实 iLink 通道" : "演示 iLink 通道"}</h3>
            <p>
              {isLive
                ? "每个客户扫码后获得独立的 ilink_bot_id、baseurl 与长轮询游标。"
                : "无需外部凭证，可模拟扫码、授权与消息收发。"}
            </p>
          </div>
        </div>
        <div className="channel-hero-meta">
          <div>
            <span>协议</span>
            <strong>{channel.protocol}</strong>
          </div>
          <div>
            <span>客户 Bot</span>
            <strong>{isLive ? `${userBots} 个` : "模拟"}</strong>
          </div>
          <div>
            <span>北辰登录</span>
            <strong>{channel.beichenConfigured ? "已配置" : "演示授权"}</strong>
          </div>
        </div>
      </section>

      <div className="channel-grid">
        <section className="card panel">
          <div className="panel-head">
            <div>
              <h3>运行模式</h3>
              <p>演示通道用于体验，真实通道用于生产</p>
            </div>
          </div>
          <div className="mode-cards">
            <button
              type="button"
              className={`mode-card ${channel.mode === "demo" ? "active" : ""}`}
              onClick={() => modeMutation.mutate("demo")}
              disabled={modeMutation.isPending}
            >
              <span className="mode-icon demo"><Sparkles size={18} /></span>
              <div>
                <strong>演示通道</strong>
                <p>无需凭证，内置客户与消息数据，可模拟扫码、收发消息。</p>
              </div>
              <span className="mode-check">{channel.mode === "demo" ? <Check size={14} /> : null}</span>
            </button>
            <button
              type="button"
              className={`mode-card ${channel.mode === "live" ? "active" : ""}`}
              onClick={() => modeMutation.mutate("live")}
              disabled={modeMutation.isPending}
            >
              <span className="mode-icon live"><Radio size={18} /></span>
              <div>
                <strong>真实 iLink 通道</strong>
                <p>每位客户扫码后独立建立 Bot 连接，消息进入对应客服会话。</p>
              </div>
              <span className="mode-check">{channel.mode === "live" ? <Check size={14} /> : null}</span>
            </button>
          </div>

          <div className="real-channel-note">
            <span className="real-channel-note-icon"><Users size={18} /></span>
            <div>
              <strong>真实通道按客户独立绑定</strong>
              <p>
                在「客户绑定」页生成专属二维码，客户用个人微信扫码确认后，系统保存该客户的
                ilink_bot_id 与 baseurl，并开始独立长轮询。不需要在后台登录统一 Bot。
              </p>
            </div>
          </div>

          {channel.lastError ? (
            <div className="channel-error">
              <AlertTriangle size={16} />
              <div>
                <strong>通道提示</strong>
                <p>{channel.lastError}</p>
              </div>
            </div>
          ) : null}

          <div className="channel-protocol">
            <h4>协议要点</h4>
            <div className="protocol-grid">
              <div>
                <Clock3 size={16} />
                <strong>24 小时 + 10 条</strong>
                <p>客户每次发言同时重置窗口和配额；任一耗尽即失去主动发送能力。</p>
              </div>
              <div>
                <MessageCircle size={16} />
                <strong>context_token</strong>
                <p>每次回复都会带回入站消息的上下文令牌，确保消息进入正确会话。</p>
              </div>
              <div>
                <RefreshCw size={16} />
                <strong>游标持久化</strong>
                <p>每个 Bot 的 get_updates_buf 独立保存，重启后从上次位置继续。</p>
              </div>
              <div>
                <Database size={16} />
                <strong>消息幂等</strong>
                <p>基于 iLink 消息 ID 去重，避免重复轮询造成重复消息。</p>
              </div>
            </div>
          </div>
        </section>

        <div className="channel-side">
          <section className="card panel config-panel">
            <div className="panel-head">
              <div>
                <h3>服务配置</h3>
                <p>用于生成授权回调地址</p>
              </div>
            </div>
            <dl className="info-list">
              <div>
                <dt>公开访问地址</dt>
                <dd className="mono ellipsis">{channel.publicBaseUrl}</dd>
              </div>
              <div>
                <dt>北辰回调地址</dt>
                <dd className="mono ellipsis">{channel.publicBaseUrl}/api/oauth/beichen/callback</dd>
              </div>
              <div>
                <dt>连接时间</dt>
                <dd>{channel.connectedAt ? fullTime(channel.connectedAt) : "—"}</dd>
              </div>
            </dl>
            <button
              type="button"
              className="btn btn-ghost btn-block"
              onClick={() => {
                navigator.clipboard.writeText(`${channel.publicBaseUrl}/api/oauth/beichen/callback`);
                toast("回调地址已复制");
              }}
            >
              <Copy size={15} /> 复制回调地址
            </button>
            {!channel.beichenConfigured ? (
              <div className="beichen-config-hint">
                <AlertTriangle size={14} />
                <span>
                  北辰 AppID / AppKey 未配置。请编辑项目根目录的 <code>.env</code>，
                  填写 <code>BEICHEN_APPID</code>、<code>BEICHEN_APPKEY</code> 后重启服务。
                </span>
              </div>
            ) : null}
          </section>

          <section className="card panel security-panel">
            <span className="security-icon"><ShieldCheck size={20} /></span>
            <div>
              <h4>凭证安全</h4>
              <p>
                每个 Bot 的 token 使用 AES-256-GCM 加密存储，不会出现在前端或客户消息中。
                北辰 AppKey 仅保存在服务端环境变量。
              </p>
            </div>
          </section>

          <section className="card panel channel-check">
            <CheckCircle2 size={18} />
            <div>
              <strong>真实通道检查</strong>
              <p>邀请一位客户扫码，确认后台出现客户档案与 24 小时窗口状态。</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
