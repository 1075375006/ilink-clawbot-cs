import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Headphones,
  LockKeyhole,
  MessageCircle,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useSupportAuth } from "../store/SupportAuthContext";

export function SupportLoginPage() {
  const { agent, loading, login } = useSupportAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!loading && agent) return <Navigate to="/support/chat" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from?.startsWith("/support/chat") ? from : "/support/chat", {
        replace: true,
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "登录失败，请稍后重试。",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="support-login">
      <header className="support-login-brand">
        <span>
          <Headphones size={21} />
        </span>
        <strong>iLink</strong>
        <i />
        客服会话
      </header>
      <main className="support-login-content">
        <section className="support-login-intro">
          <span className="support-eyebrow">为每一次真诚的沟通而设计</span>
          <h1>
            专注对话，
            <br />
            让服务更有温度<span>。</span>
          </h1>
          <p>
            熟悉的聊天方式，专属的服务空间。
            <br />
            从一声“你好”开始，连接每一位客户。
          </p>
          <div className="support-login-illustration" aria-hidden="true">
            <div className="support-demo-title">
              <span className="support-demo-avatar">林</span>
              <span>
                <strong>客户咨询</strong>
                <small>微信 · 会话进行中</small>
              </span>
              <i />
            </div>
            <div className="support-demo-bubble">你好，想了解一下产品～</div>
            <div className="support-demo-bubble mine">
              您好！很高兴为您服务 😊
            </div>
            <div className="support-demo-typing">
              <i />
              <i />
              <i />
            </div>
          </div>
          <span className="support-login-assurance">
            <ShieldCheck size={15} /> 独立账号 · 安全会话 · 消息实时同步
          </span>
        </section>
        <section className="support-login-card">
          <span className="support-login-icon">
            <MessageCircle size={25} />
          </span>
          <h2>客服登录</h2>
          <p>登录你的专属聊天工作台</p>
          <form onSubmit={submit}>
            <label htmlFor="support-username">客服账号</label>
            <div className="support-login-input">
              <UserRound size={18} />
              <input
                id="support-username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入管理员开通的账号"
                maxLength={40}
                required
              />
            </div>
            <label htmlFor="support-password">登录密码</label>
            <div className="support-login-input">
              <LockKeyhole size={18} />
              <input
                id="support-password"
                type={visible ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入登录密码"
                maxLength={128}
                required
              />
              <button
                type="button"
                aria-label={visible ? "隐藏密码" : "显示密码"}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            {error ? (
              <div className="form-error" role="alert">
                {error}
              </div>
            ) : null}
            <button
              className="support-primary support-login-submit"
              disabled={busy || loading}
              type="submit"
            >
              {busy ? "正在登录…" : "进入聊天工作台"}
              <ArrowRight size={17} />
            </button>
          </form>
          <div className="support-login-help">
            还没有账号或忘记密码？请联系管理员开通或重置。
          </div>
          <Link to="/login" className="support-admin-link">
            管理后台登录 <ArrowRight size={13} />
          </Link>
        </section>
      </main>
      <footer className="support-login-footer">
        iLink 客服会话系统 <span>让沟通简单一点</span>
      </footer>
    </div>
  );
}
