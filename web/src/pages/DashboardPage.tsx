import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  Clock3,
  HeartPulse,
  MessageCircle,
  MessageSquareText,
  Plus,
  QrCode,
  Radio,
  Users,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { DashboardData } from "../types";
import { dayjs, shortTime } from "../lib/format";
import { Avatar } from "../components/Avatar";
import { PageSkeleton } from "../components/Skeleton";
import { WindowPill } from "../components/WindowPill";
import { TrendChart } from "../components/charts/TrendChart";
import { BarChart } from "../components/charts/BarChart";
import { EmptyState } from "../components/EmptyState";

function MiniBars({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(1, ...values);
  return (
    <span className="mini-bars" aria-hidden="true">
      {values.map((value, index) => (
        <i
          key={index}
          style={{
            height: `${Math.max(4, (value / max) * 26)}px`,
            background: index === values.length - 1 ? color : `${color}55`,
          }}
        />
      ))}
    </span>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<DashboardData>("/api/dashboard"),
  });

  if (isLoading || !data) return <PageSkeleton />;

  const bindings = data.trend.map((item) => item.bindings);
  const inbound = data.trend.map((item) => item.inbound);
  const outbound = data.trend.map((item) => item.outbound);
  const yesterday = data.trend[data.trend.length - 2]?.bindings ?? 0;
  const bindingDelta = data.stats.todayBindings - yesterday;
  const hour = dayjs().hour();
  const greeting = hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";

  const cards = [
    {
      label: "今日新增绑定",
      value: data.stats.todayBindings,
      unit: "位客户",
      icon: QrCode,
      tone: "blue",
      foot:
        bindingDelta === 0
          ? "与昨日持平"
          : bindingDelta > 0
            ? `较昨日 +${bindingDelta}`
            : `较昨日 ${bindingDelta}`,
      values: bindings,
      color: "#2E86AB",
    },
    {
      label: "活跃对话",
      value: data.stats.activeConversations,
      unit: "个会话",
      icon: MessageCircle,
      tone: "teal",
      foot: "过去 24 小时内有互动",
      values: inbound,
      color: "#0EA5A5",
    },
    {
      label: "待回复消息",
      value: data.stats.pendingReplies,
      unit: "位客户",
      icon: MessageSquareText,
      tone: "amber",
      foot: data.stats.pendingReplies ? "建议优先处理" : "所有消息已回复",
      values: outbound,
      color: "#E08A1E",
    },
    {
      label: "本日保活触发",
      value: data.stats.todayKeepalive,
      unit: "次",
      icon: HeartPulse,
      tone: data.keepaliveEnabled ? "rose" : "gray",
      foot: data.keepaliveEnabled ? "保活策略运行中" : "保活已关闭",
      values: outbound,
      color: "#D95F76",
    },
  ];

  return (
    <div className="page-enter">
      <div className="page-heading-row">
        <div>
          <h2 className="page-title">
            {greeting}，{dayjs().hour() < 12 ? "今天也从容一点" : "辛苦了"}
          </h2>
          <p className="page-sub">
            这是 {dayjs().format("M 月 D 日")} 的客户概况，共有 {data.stats.pendingReplies} 位客户在等待回复。
          </p>
        </div>
        <div className="heading-actions">
          <Link to="/invite" className="btn btn-ghost">
            <QrCode size={16} />
            邀请客户
          </Link>
          <Link to="/workbench" className="btn btn-primary">
            <MessageCircle size={16} />
            进入对话
          </Link>
        </div>
      </div>

      {data.channel.mode === "live" && !data.channel.connected ? (
        <div className="setup-banner">
          <span className="setup-banner-icon"><Radio size={18} /></span>
          <div>
            <strong>还没有客户接入真实 iLink 通道</strong>
            <p>生成客户专属二维码，客户用个人微信扫码后即可建立独立 Bot 连接。</p>
          </div>
          <Link to="/invite" className="btn btn-primary btn-sm">
            生成客户二维码
          </Link>
        </div>
      ) : null}

      <div className="stat-grid">
        {cards.map((card) => (
          <article className={`stat-card card tone-${card.tone}`} key={card.label}>
            <div className="stat-top">
              <span className={`stat-icon ${card.tone}`}>
                <card.icon size={19} strokeWidth={1.9} />
              </span>
              <MiniBars values={card.values.slice(-6)} color={card.color} />
            </div>
            <div className="stat-value">
              {card.value}
              <span>{card.unit}</span>
            </div>
            <div className="stat-label">{card.label}</div>
            <div className="stat-foot">{card.foot}</div>
          </article>
        ))}
      </div>

      <div className="chart-grid">
        <section className="card panel">
          <div className="panel-head">
            <div>
              <h3>绑定用户趋势</h3>
              <p>最近 7 天完成身份授权的客户</p>
            </div>
          </div>
          <TrendChart data={data.trend.map((item) => ({ date: item.date, value: item.bindings }))} />
        </section>
        <section className="card panel">
          <div className="panel-head">
            <div>
              <h3>消息往来</h3>
              <p>客户消息与客服回复</p>
            </div>
          </div>
          <BarChart data={data.trend} />
        </section>
      </div>

      <div className="dashboard-bottom">
        <section className="card panel recent-panel">
          <div className="panel-head">
            <div>
              <h3>最近对话</h3>
              <p>按最新消息排序，点开即可继续沟通</p>
            </div>
            <Link to="/workbench" className="text-link">
              全部对话 <ArrowRight size={14} />
            </Link>
          </div>
          {data.conversations.length ? (
            <div className="recent-list">
              {data.conversations.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  className="recent-row"
                  onClick={() => navigate(`/workbench/${user.id}`)}
                >
                  <span className="avatar-wrap">
                    <Avatar src={user.avatar} name={user.name} size={42} />
                    {user.unread > 0 ? <i className="avatar-badge">{Math.min(9, user.unread)}</i> : null}
                  </span>
                  <span className="recent-main">
                    <span className="recent-name">
                      {user.name}
                      {user.lastMessageDirection === "outbound" ? (
                        <em>{user.lastMessageIsKeepalive ? "保活" : "已回复"}</em>
                      ) : null}
                    </span>
                    <span className="recent-msg">
                      {user.lastMessage
                        ? user.lastMessage.startsWith("http")
                          ? "授权链接"
                          : user.lastMessage
                        : "还没有消息，打个招呼吧"}
                    </span>
                  </span>
                  <span className="recent-side">
                    <span className="recent-time">{shortTime(user.lastMessageAt ?? user.lastActiveAt)}</span>
                    <WindowPill
                      seconds={user.windowRemainingSeconds}
                      replyRemaining={user.replyRemaining}
                      accountStatus={user.accountStatus}
                      compact
                    />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<MessageCircle size={22} />}
              title="还没有对话"
              description="邀请第一位客户绑定 ClawBot，开始一段新的服务。"
              action={
                <Link to="/invite" className="btn btn-primary btn-sm">
                  <Plus size={15} /> 邀请客户
                </Link>
              }
            />
          )}
        </section>

        <div className="dashboard-side">
          <section className="card panel todo-panel">
            <div className="panel-head">
              <div>
                <h3>今日待办</h3>
                <p>把注意力放在最需要的地方</p>
              </div>
            </div>
            <button type="button" className="todo-item" onClick={() => navigate("/chat")}>
              <span className="todo-icon amber"><MessageSquareText size={18} /></span>
              <span>
                <strong>{data.stats.pendingReplies} 位客户等待回复</strong>
                <small>及时回复能延长会话窗口</small>
              </span>
              <ArrowUpRight size={16} />
            </button>
            <button type="button" className="todo-item" onClick={() => navigate("/keepalive")}>
              <span className="todo-icon rose"><HeartPulse size={18} /></span>
              <span>
                <strong>{data.keepaliveEnabled ? "保活策略运行中" : "保活策略已暂停"}</strong>
                <small>
                  {data.keepaliveEnabled ? "窗口到期前自动温和触达" : "开启后可在窗口关闭前提醒客户"}
                </small>
              </span>
              <ArrowUpRight size={16} />
            </button>
            <button type="button" className="todo-item" onClick={() => navigate("/customers")}>
              <span className="todo-icon teal"><Users size={18} /></span>
              <span>
                <strong>{data.stats.activeConversations} 个活跃会话</strong>
                <small>过去 24 小时内有客户发言</small>
              </span>
              <ArrowUpRight size={16} />
            </button>
          </section>

          <section className="card panel channel-panel">
            <div className="channel-panel-top">
              <span className={`channel-orb ${data.channel.connected ? "online" : ""}`}>
                <Radio size={19} />
              </span>
              <div>
                <h3>{data.channel.mode === "live" ? "真实 ClawBot 通道" : "演示 ClawBot 通道"}</h3>
                <p>{data.channel.connected ? "消息通道连接正常" : "通道未连接，消息无法收发"}</p>
              </div>
            </div>
            <div className="channel-meta">
              <span>
                <Clock3 size={14} />
                {data.channel.mode === "demo" ? "无需凭证，可直接体验" : data.channel.lastError ?? "长轮询运行中"}
              </span>
              <button type="button" className="text-link" onClick={() => navigate("/settings/channel")}>
                查看通道 <ArrowRight size={13} />
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
