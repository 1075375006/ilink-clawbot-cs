import { useSearchParams } from "react-router-dom";
import { Check, ChevronRight, LockKeyhole, MessageCircle, ShieldCheck } from "lucide-react";

export function MockOAuthPage() {
  const [params] = useSearchParams();
  const state = params.get("state") ?? "";

  const authorize = () => {
    window.location.href = `/api/oauth/beichen/callback?state=${encodeURIComponent(
      state,
    )}&code=mock_authorization_code&type=wx`;
  };

  return (
    <div className="oauth-page">
      <div className="oauth-card">
        <div className="oauth-top">
          <span className="oauth-app-icon">
            <MessageCircle size={26} />
          </span>
          <h1>iLink 客服中心</h1>
          <p>申请使用你的微信公开信息</p>
        </div>
        <div className="oauth-account">
          <span className="oauth-avatar">微</span>
          <div>
            <strong>微信用户</strong>
            <small>用于识别你的客服身份</small>
          </div>
          <span className="oauth-selected"><Check size={14} /></span>
        </div>
        <div className="oauth-permissions">
          <span>将获得以下信息</span>
          <div><Check size={14} /> 昵称</div>
          <div><Check size={14} /> 头像</div>
          <div><Check size={14} /> 第三方唯一标识（social_uid）</div>
        </div>
        <div className="oauth-security">
          <ShieldCheck size={16} />
          <p>
            本页面为演示授权页。正式环境会跳转至北辰聚合登录，仅获取公开资料，
            不会读取聊天记录或微信密码。
          </p>
        </div>
        <button type="button" className="btn btn-wechat" onClick={authorize} disabled={!state}>
          同意并授权
          <ChevronRight size={17} />
        </button>
        <button type="button" className="oauth-cancel" onClick={() => window.history.back()}>
          暂不授权
        </button>
        <div className="oauth-foot">
          <LockKeyhole size={13} />
          北辰聚合登录提供安全授权
        </div>
      </div>
    </div>
  );
}
