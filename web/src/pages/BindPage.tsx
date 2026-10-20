import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  Link2,
  Loader2,
  LockKeyhole,
  MessageCircle,
  QrCode,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { BindingSession } from "../types";
import { duration, fullTime } from "../lib/format";
import { remainingSeconds, useNow } from "../lib/useNow";
import { Avatar } from "../components/Avatar";

interface BindProps {
  autoScan?: boolean;
  successView?: boolean;
}

function Brand() {
  return (
    <div className="bind-brand">
      <span className="brand-mark brand-mark-light">
        <MessageCircle size={22} />
      </span>
      <span>
        <strong>iLink</strong> 客服中心
      </span>
      <em>
        <ShieldCheck size={13} /> 安全绑定
      </em>
    </div>
  );
}

function Steps({ active }: { active: number }) {
  const steps = ["授权身份", "扫码绑定", "开始对话"];
  return (
    <ol className="bind-steps">
      {steps.map((step, index) => (
        <li
          key={step}
          className={index < active ? "done" : index === active ? "current" : ""}
        >
          <span>{index < active ? <Check size={13} /> : index + 1}</span>
          <em>{step}</em>
        </li>
      ))}
    </ol>
  );
}

export function BindPage({ autoScan = false, successView = false }: BindProps) {
  const [params] = useSearchParams();
  const tokenFromUrl = params.get("token") ?? "";
  const queryClient = useQueryClient();
  const now = useNow();
  const [token, setToken] = useState(tokenFromUrl);
  const scannedRef = useRef(false);
  const createdRef = useRef(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [scanning, setScanning] = useState(false);

  const createSession = useMutation({
    mutationFn: () =>
      api<{ token: string; mode: "demo" | "live"; expiresAt: string; qrUrl: string }>(
        "/api/public/bind/sessions",
        { method: "POST" },
      ),
    onSuccess: (data) => {
      setToken(data.token);
      setCreating(false);
    },
    onError: (error) => {
      setCreating(false);
      setCreateError(error instanceof Error ? error.message : "无法生成二维码");
    },
  });

  useEffect(() => {
    if (successView || token || createdRef.current) return;
    createdRef.current = true;
    setCreating(true);
    createSession.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [successView]);

  const sessionQuery = useQuery({
    queryKey: ["bind-session", token],
    queryFn: () => api<BindingSession>(`/api/public/bind/${token}`),
    enabled: Boolean(token),
    refetchInterval: (query) => {
      const data = query.state.data;
      const status = data?.status;
      return status === "completed" || status === "expired" ? false : 2000;
    },
  });

  const session = sessionQuery.data;

  const simulate = useMutation({
    mutationFn: () =>
      api<BindingSession>(`/api/public/bind/${token}/simulate-scan`, { method: "POST" }),
    onSuccess: (data) => {
      queryClient.setQueryData(["bind-session", token], data);
      queryClient.invalidateQueries({ queryKey: ["bind-session", token] });
    },
    onError: (error) => {
      setScanning(false);
      setCreateError(error instanceof Error ? error.message : "模拟扫码失败");
    },
  });

  const refreshQr = useMutation({
    mutationFn: () =>
      api<BindingSession>(`/api/public/bind/${token}/refresh-qr`, { method: "POST" }),
    onSuccess: (data) => {
      setScanning(false);
      queryClient.setQueryData(["bind-session", token], data);
      queryClient.invalidateQueries({ queryKey: ["bind-session", token] });
    },
    onError: (error) => {
      setScanning(false);
      setCreateError(error instanceof Error ? error.message : "刷新二维码失败");
    },
  });

  useEffect(() => {
    if (!autoScan || scannedRef.current || !session) return;
    if (session.mode !== "demo" || session.status !== "scanned") return;
    scannedRef.current = true;
    setScanning(true);
    simulate.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScan, session]);

  const expiresIn = remainingSeconds(session?.expiresAt ?? null, now);
  const activeStep =
    session?.status === "completed" ? 3 : session?.status === "scanned" ? 1 : 0;
  return (
    <div className="bind-page">
      <div className="bind-bg-orb bind-bg-orb-1" />
      <div className="bind-bg-orb bind-bg-orb-2" />
      <header className="bind-header">
        <Brand />
        <span className="bind-secure">
          <LockKeyhole size={13} /> 信息仅用于客服识别
        </span>
      </header>

      <main className="bind-main">
        <section className="bind-intro">
          <span className="bind-eyebrow">
            <Sparkles size={14} /> 微信 ClawBot 专属客服通道
          </span>
          <h1>
            扫一扫，
            <br />
            找到你的专属客服。
          </h1>
          <p>
            绑定后，你可以直接在微信里和客服对话。我们会展示你的头像与昵称，
            让每一次沟通都更亲切、更准确。
          </p>
          <Steps active={activeStep} />
          <div className="bind-trust">
            <div>
              <ShieldCheck size={17} />
              <span>北辰聚合登录授权，不获取密码</span>
            </div>
            <div>
              <Link2 size={17} />
              <span>一位客户仅绑定一个客服账号</span>
            </div>
            <div>
              <UserRound size={17} />
              <span>仅获取昵称与头像，用于服务识别</span>
            </div>
          </div>
          <div className="bind-quote">
            <MessageCircle size={18} />
            <p>“从扫码到有人回应，只用了不到一分钟。”</p>
            <span>— 一位刚完成绑定的客户</span>
          </div>
        </section>

        <section className="bind-card">
          {creating ? (
            <div className="bind-state">
              <Loader2 size={28} className="spin" />
              <h3>正在准备绑定页…</h3>
              <p>通常只需要几秒钟</p>
            </div>
          ) : successView && !token ? (
            <div className="bind-state">
              <span className="bind-state-icon warn"><Clock3 size={24} /></span>
              <h3>绑定链接不完整</h3>
              <p>请重新扫描客服提供的二维码，或联系客服获取新的绑定链接。</p>
            </div>
          ) : sessionQuery.isError ? (
            <div className="bind-state">
              <span className="bind-state-icon warn"><Clock3 size={24} /></span>
              <h3>绑定链接已失效</h3>
              <p>这条绑定链接不存在或已过期，请让客服重新生成二维码。</p>
              {!successView ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setToken("");
                    setCreating(true);
                    createdRef.current = true;
                    createSession.mutate();
                  }}
                >
                  <RefreshCw size={16} /> 生成新的绑定链接
                </button>
              ) : null}
            </div>
          ) : createError ? (
            <div className="bind-state">
              <span className="bind-state-icon error"><RefreshCw size={24} /></span>
              <h3>绑定页暂时无法准备</h3>
              <p>{createError}</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setCreateError("");
                  setCreating(true);
                  createSession.mutate();
                }}
              >
                重新尝试
              </button>
            </div>
          ) : session?.status === "completed" ? (
            <div className="bind-success">
              <span className="success-ring">
                <CheckCircle2 size={34} />
              </span>
              <h3>绑定成功</h3>
              <p>身份授权与 ClawBot 绑定均已完成，现在可以直接和客服对话了。</p>
              <div className="bind-user">
                <Avatar src={session.user?.avatar} name={session.user?.name ?? "客户"} size={56} />
                <div>
                  <strong>{session.user?.name}</strong>
                  <span>已于 {session.completedAt ? fullTime(session.completedAt) : "刚刚"} 完成绑定</span>
                </div>
              </div>
              <div className="bind-success-tip">
                <MessageCircle size={16} />
                回到微信 ClawBot 窗口，发送任意消息即可开始咨询。
              </div>
              <a className="btn btn-primary" href={session.oauthUrl ?? "#"} onClick={(event) => event.preventDefault()}>
                知道了
              </a>
            </div>
          ) : session?.status === "awaiting_oauth" ? (
            <div className="bind-oauth">
              <div className="bind-card-head">
                <span className="bind-card-icon"><ShieldCheck size={20} /></span>
                <div>
                  <h3>先完成身份授权</h3>
                  <p>授权昵称与头像，便于客服识别你</p>
                </div>
              </div>

              <div className="oauth-intro">
                <div className="oauth-intro-steps">
                  <span><i>1</i> 微信 / QQ 授权</span>
                  <span><i>2</i> 扫码绑定 ClawBot</span>
                  <span><i>3</i> 开始对话</span>
                </div>
                <p>授权完成后，本页会自动展示 ClawBot 绑定二维码。</p>
              </div>

              <a
                className="btn btn-primary btn-oauth"
                href={session.oauthUrl ?? "#"}
                onClick={(event) => {
                  if (!session.oauthUrl) event.preventDefault();
                }}
              >
                <ShieldCheck size={17} />
                微信 / QQ 授权登录
                <ArrowRight size={16} />
              </a>
              <div className="oauth-note">
                <LockKeyhole size={13} />
                授权仅获取昵称与头像，不会获取你的微信密码。
              </div>
            </div>
          ) : session?.status === "scanned" &&
            (expiresIn <= 0 || session.scanStatus === "expired") ? (
            <div className="bind-state">
              <span className="bind-state-icon warn"><Clock3 size={24} /></span>
              <h3>ClawBot 二维码已过期</h3>
              <p>身份授权已完成，刷新二维码即可继续完成 ClawBot 绑定。</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => refreshQr.mutate()}
                disabled={refreshQr.isPending}
              >
                {refreshQr.isPending ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                刷新二维码
              </button>
            </div>
          ) : session?.status === "expired" ? (
            <div className="bind-state">
              <span className="bind-state-icon warn"><Clock3 size={24} /></span>
              <h3>绑定链接已过期</h3>
              <p>身份授权链接仅保留 10 分钟，请让客服重新生成绑定二维码。</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setToken("");
                  setCreating(true);
                  createSession.mutate();
                }}
              >
                <RefreshCw size={16} /> 刷新二维码
              </button>
            </div>
          ) : (
            <div className="bind-qr">
              <div className="bind-card-head">
                <span className="bind-card-icon"><QrCode size={20} /></span>
                <div>
                  <h3>扫码绑定 ClawBot</h3>
                  <p>身份已授权，请用微信扫描下方二维码完成 ClawBot 绑定</p>
                </div>
              </div>

              {session?.user ? (
                <div className="bind-user">
                  <Avatar src={session.user.avatar} name={session.user.name} size={44} />
                  <div>
                    <strong>{session.user.name}</strong>
                    <span>身份授权已完成</span>
                  </div>
                </div>
              ) : null}

              {session?.mode === "live" ? (
                <div className="live-qr-block">
                  <div className="qr-frame">
                    <img src={`/api/public/bind/${token}/qr.png`} alt="ClawBot 绑定二维码" />
                    <i className="qr-corner tl" />
                    <i className="qr-corner tr" />
                    <i className="qr-corner bl" />
                    <i className="qr-corner br" />
                  </div>
                  <div className="qr-meta">
                    <span className="qr-status">
                      <span className="status-dot online" />
                      {session.scanStatus === "scaned" ? "已扫码，等待微信确认" : "真实通道 · 等待扫码"}
                    </span>
                    <span className="qr-expiry">
                      <Clock3 size={13} /> {duration(expiresIn)} 后失效
                    </span>
                  </div>
                  <p className="qr-help">
                    扫码后请在微信中确认。确认完成后，系统会激活你的 ClawBot 会话。
                  </p>
                  {session.pollError ? <div className="field-error">{session.pollError}</div> : null}
                  <button type="button" className="btn btn-ghost btn-block" onClick={() => refreshQr.mutate()}>
                    <RefreshCw size={15} /> 刷新二维码
                  </button>
                </div>
              ) : (
                <>
                  <div className={`qr-frame ${scanning ? "scanning" : ""}`}>
                    {token ? (
                      <img src={`/api/public/bind/${token}/qr.png`} alt="ClawBot 绑定二维码" />
                    ) : (
                      <span className="qr-loading"><Loader2 size={24} className="spin" /></span>
                    )}
                    <i className="qr-corner tl" />
                    <i className="qr-corner tr" />
                    <i className="qr-corner bl" />
                    <i className="qr-corner br" />
                    {scanning ? <span className="scan-beam" /> : null}
                  </div>
                  <div className="qr-meta">
                    <span className="qr-status">
                      <span className="status-dot online" /> 等待扫码
                    </span>
                    <span className="qr-expiry">
                      <Clock3 size={13} /> {duration(expiresIn)} 后失效
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    disabled={scanning}
                    onClick={() => {
                      setScanning(true);
                      simulate.mutate();
                    }}
                  >
                    {scanning ? <Loader2 size={17} className="spin" /> : <ScanLine size={17} />}
                    {scanning ? "正在模拟扫码…" : "模拟扫码（演示）"}
                  </button>
                  <p className="qr-help">
                    演示模式无需真实微信，点击上方按钮即可体验完整绑定流程。
                  </p>
                </>
              )}

              <div className="bind-how">
                <span>扫码后会发生什么？</span>
                <div>
                  <span><i><ShieldCheck size={13} /></i> 微信确认 ClawBot 绑定</span>
                  <span><i><MessageCircle size={13} /></i> 系统保存客户 Bot 凭证</span>
                  <span><i><Sparkles size={13} /></i> 自动进入客服客户列表</span>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="bind-foot">
        <span>Powered by iLink ClawBot · 北辰聚合登录</span>
        <span>鸿蒙版微信当前可能不完全支持 ClawBot，请使用 iOS / Android 微信</span>
      </footer>
    </div>
  );
}
