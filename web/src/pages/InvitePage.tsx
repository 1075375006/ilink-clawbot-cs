import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Clock3,
  Copy,
  ExternalLink,
  Loader2,
  MessageCircle,
  QrCode,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Users,
} from "lucide-react";
import { api } from "../api";
import type { ChannelStatus } from "../types";
import { dayjs, duration } from "../lib/format";
import { remainingSeconds, useNow } from "../lib/useNow";
import { Avatar } from "../components/Avatar";
import { EmptyState } from "../components/EmptyState";
import { useToast } from "../store/ToastContext";

interface CreatedSession {
  token: string;
  mode: "demo" | "live";
  expiresAt: string;
  bindUrl: string;
  qrUrl: string;
}

interface RecentItem {
  token: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  name: string | null;
  avatar: string | null;
}

export function InvitePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const now = useNow();
  const [session, setSession] = useState<CreatedSession | null>(null);
  const createdRef = useRef(false);

  const { data: channel } = useQuery({
    queryKey: ["channel"],
    queryFn: () => api<ChannelStatus>("/api/channel"),
  });

  const recent = useQuery({
    queryKey: ["bind-recent"],
    queryFn: () => api<{ items: RecentItem[] }>("/api/bind/sessions/recent"),
    refetchInterval: 10_000,
  });

  const create = useMutation({
    mutationFn: () => api<CreatedSession>("/api/bind/sessions", { method: "POST" }),
    onSuccess: (data) => {
      setSession(data);
      queryClient.invalidateQueries({ queryKey: ["bind-recent"] });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "生成失败", "error"),
  });

  useEffect(() => {
    if (createdRef.current) return;
    createdRef.current = true;
    create.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const expiresIn = remainingSeconds(session?.expiresAt ?? null, now);
  const mode = channel?.mode ?? session?.mode ?? "demo";
  const link = session ? `${window.location.origin}/bind?token=${session.token}` : "";

  const copy = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(link);
      toast("绑定链接已复制");
    } catch {
      toast("复制失败，请手动选择链接", "error");
    }
  };

  return (
    <div className="page-enter">
      <div className="page-heading-row">
        <div>
          <h2 className="page-title">邀请客户加入</h2>
          <p className="page-sub">生成专属二维码，客户扫码并完成授权后自动进入客户列表。</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => create.mutate()}
          disabled={create.isPending}
        >
          <RefreshCw size={16} className={create.isPending ? "spin" : ""} />
          重新生成
        </button>
      </div>

      <div className="invite-layout">
        <section className="card invite-card">
          <div className="invite-card-head">
            <div>
              <span className="invite-eyebrow">
                <QrCode size={14} /> {mode === "live" ? "真实通道" : "演示通道"}
              </span>
              <h3>扫码进入客户绑定</h3>
              <p>
                客户扫码进入绑定页，先完成北辰身份授权，再扫描 ClawBot
                二维码完成绑定。
              </p>
            </div>
          </div>

          <div className="invite-qr-wrap">
            <div className="invite-qr-frame">
              {session ? (
                <img src={session.qrUrl} alt="客户绑定二维码" />
              ) : (
                <span className="qr-loading"><Loader2 size={24} className="spin" /></span>
              )}
              <i className="qr-corner tl" />
              <i className="qr-corner tr" />
              <i className="qr-corner bl" />
              <i className="qr-corner br" />
            </div>
            <div className="invite-qr-meta">
              <span className="qr-expiry">
                <Clock3 size={14} /> {expiresIn > 0 ? `${duration(expiresIn)} 后失效` : "二维码已过期"}
              </span>
              <button type="button" className="text-link" onClick={() => create.mutate()}>
                刷新
              </button>
            </div>
          </div>

          <div className="invite-actions">
            <button type="button" className="btn btn-ghost" onClick={copy} disabled={!session}>
              <Copy size={15} /> 复制链接
            </button>
            {session ? (
              <>
                <a className="btn btn-ghost" href={`/bind?token=${session.token}`} target="_blank" rel="noreferrer">
                  <ExternalLink size={15} /> 预览绑定页
                </a>
              </>
            ) : null}
          </div>

          <div className="invite-note">
            <ShieldCheck size={15} />
            <span>
              每位客户使用独立绑定链接，10 分钟内有效；身份授权与 ClawBot
              绑定都完成后才会进入客户列表。
            </span>
          </div>
        </section>

        <div className="invite-side">
          <section className="card panel invite-flow">
            <div className="panel-head">
              <div>
                <h3>绑定流程</h3>
                <p>整个过程约 1 分钟</p>
              </div>
            </div>
            <div className="flow-steps">
              <div>
                <span className="flow-num active"><QrCode size={16} /></span>
                <strong>客户扫码打开绑定页</strong>
                <p>使用微信扫描专属二维码，进入身份授权页。</p>
              </div>
              <div>
                <span className="flow-num"><ShieldCheck size={16} /></span>
                <strong>北辰身份授权</strong>
                <p>通过北辰聚合登录获取头像、昵称与 social_uid。</p>
              </div>
              <div>
                <span className="flow-num"><ScanLine size={16} /></span>
                <strong>扫码绑定 ClawBot</strong>
                <p>授权完成后，在同一页面扫描 ClawBot 二维码完成绑定。</p>
              </div>
              <div>
                <span className="flow-num"><MessageCircle size={16} /></span>
                <strong>开始对话</strong>
                <p>客户自动出现在列表，可直接发起一对一沟通。</p>
              </div>
            </div>
            <div className="flow-check">
              <Check size={14} />
              未完成授权前不会进入客户列表
            </div>
          </section>

          <section className="card panel recent-bind">
            <div className="panel-head">
              <div>
                <h3>最近绑定</h3>
                <p>最近 10 条绑定会话</p>
              </div>
              <Users size={18} className="panel-soft-icon" />
            </div>
            <div className="recent-bind-list">
              {recent.data?.items.length ? (
                recent.data.items.map((item) => (
                  <div className="recent-bind-row" key={item.token}>
                    <Avatar src={item.avatar} name={item.name ?? "待授权客户"} size={34} />
                    <div>
                      <strong>{item.name ?? "等待授权完成"}</strong>
                      <small>{dayjs(item.createdAt).format("MM/DD HH:mm")}</small>
                    </div>
                    <span className={`bind-status ${item.status}`}>
                      {item.status === "completed"
                        ? "已绑定"
                        : item.status === "awaiting_oauth"
                          ? "待授权"
                          : item.status === "scanned"
                            ? "待绑定 ClawBot"
                          : item.status === "expired"
                            ? "已过期"
                            : "待访问"}
                    </span>
                  </div>
                ))
              ) : (
                <EmptyState
                  icon={<QrCode size={20} />}
                  title="还没有绑定记录"
                  description="生成二维码并邀请客户后会显示在这里。"
                />
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
