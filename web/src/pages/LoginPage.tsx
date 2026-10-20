import { useState, type FormEvent } from "react";
import { ArrowRight, Loader2, LockKeyhole, Mail, MessageCircle, ShieldCheck, Sparkles } from "lucide-react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../store/AuthContext";
import { ApiError } from "../api";

export function LoginPage() {
  const isDev = import.meta.env.DEV;
  const { admin, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState(isDev ? "admin@ilink.local" : "");
  const [password, setPassword] = useState(isDev ? "admin123456" : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!loading && admin) return <Navigate to="/" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== "/login" ? from : "/", { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "登录失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-visual">
        <div className="login-grid" />
        <div className="login-orb login-orb-1" />
        <div className="login-orb login-orb-2" />
        <div className="login-brand">
          <span className="brand-mark brand-mark-light">
            <MessageCircle size={24} strokeWidth={1.8} />
          </span>
          <span>
            <strong>iLink</strong> 客服中心
          </span>
        </div>
        <div className="login-copy">
          <span className="login-eyebrow">
            <Sparkles size={14} />
            ClawBot 客户触达
          </span>
          <h1>
            让每一次咨询，
            <br />
            都被认真回应。
          </h1>
          <p>
            从扫码绑定到日常对话，再到主动关怀。把分散在微信里的客户沟通，收进一个清晰、从容的工作台。
          </p>
          <div className="login-points">
            <div>
              <ShieldCheck size={18} />
              <span>聚合登录授权补齐头像昵称，身份清晰可辨</span>
            </div>
            <div>
              <MessageCircle size={18} />
              <span>24 小时会话窗口实时提醒，不错过任何一次回复</span>
            </div>
            <div>
              <Sparkles size={18} />
              <span>保活策略自然触达，在窗口关闭前留住对话</span>
            </div>
          </div>
        </div>
        <div className="login-quote">
          <div className="quote-avatars">
            <span>林</span>
            <span>陈</span>
            <span>周</span>
            <span>+</span>
          </div>
          <p>“客户说，第一次觉得被一个品牌认真地记住了。”</p>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <div className="login-card-head">
            <span className="login-mini-logo">
              <MessageCircle size={20} />
            </span>
            <h2>欢迎回来</h2>
            <p>登录客服工作台，开始今天的对话</p>
          </div>
          <form onSubmit={submit} className="login-form">
            <label>
              <span>邮箱</span>
              <div className="input-wrap">
                <Mail size={17} />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@company.com"
                  autoComplete="username"
                  required
                />
              </div>
            </label>
            <label>
              <span>密码</span>
              <div className="input-wrap">
                <LockKeyhole size={17} />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="请输入密码"
                  autoComplete="current-password"
                  required
                />
              </div>
            </label>
            {error ? <div className="form-error">{error}</div> : null}
            <button className="btn btn-primary btn-login" type="submit" disabled={busy}>
              {busy ? <Loader2 size={18} className="spin" /> : null}
              {busy ? "正在登录…" : "进入工作台"}
              {!busy ? <ArrowRight size={17} /> : null}
            </button>
          </form>
          {isDev ? (
            <div className="demo-hint">
              <span>演示账号</span>
              <code>admin@ilink.local</code>
              <code>admin123456</code>
            </div>
          ) : null}
          <p className="login-foot">登录即表示你同意遵守客户数据保护规范</p>
        </div>
      </section>
    </div>
  );
}
