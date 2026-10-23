import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  ChevronDown,
  HeartPulse,
  Headphones,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  MessagesSquare,
  QrCode,
  Send,
  Settings2,
  Users,
  X,
} from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { io } from "socket.io-client";
import { api } from "../api";
import { useAuth } from "../store/AuthContext";
import { useToast } from "../store/ToastContext";
import type { ChannelStatus } from "../types";
import { dayjs } from "../lib/format";
import { Avatar } from "./Avatar";

const NAV = [
  { to: "/", label: "仪表盘", icon: LayoutDashboard, end: true },
  { to: "/customers", label: "客户列表", icon: Users },
  { to: "/workbench", label: "对话工作台", icon: MessageCircle },
  { to: "/push", label: "消息推送", icon: Send },
  { to: "/keepalive", label: "保活设置", icon: HeartPulse },
];

const CHANNEL_NAV = [
  { to: "/invite", label: "客户绑定", icon: QrCode },
  { to: "/settings/channel", label: "通道状态", icon: Settings2 },
  { to: "/settings/agents", label: "客服账号", icon: Headphones },
];

const TITLES: Record<string, { title: string; subtitle: string }> = {
  "/": { title: "仪表盘", subtitle: "今天的客户动态，一眼掌握" },
  "/customers": { title: "客户列表", subtitle: "已绑定 ClawBot 的客户档案" },
  "/chat": { title: "对话工作台", subtitle: "与客户保持顺畅沟通" },
  "/workbench": { title: "对话工作台", subtitle: "与客户保持顺畅沟通" },
  "/push": { title: "消息推送", subtitle: "把重要信息送达每一位客户" },
  "/keepalive": { title: "保活设置", subtitle: "在会话窗口关闭前，自然地保持联系" },
  "/invite": { title: "客户绑定", subtitle: "生成专属二维码，邀请客户加入" },
  "/settings/channel": { title: "通道状态", subtitle: "按客户维护 iLink Bot 连接与授权服务" },
  "/settings/agents": { title: "客服账号", subtitle: "管理团队成员与独立客服登录权限" },
};

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path
          d="M6 7.5h13.5a5 5 0 0 1 5 5v5a5 5 0 0 1-5 5h-6.2l-4.1 3.2a1 1 0 0 1-1.6-.8v-2.6A5 5 0 0 1 4 18.5v-6a5 5 0 0 1 2-5Z"
          fill="currentColor"
          opacity=".18"
        />
        <path
          d="M7 6h12.8a5 5 0 0 1 5 5v5a5 5 0 0 1-5 5h-5.3l-4.7 3.4v-3.6A5 5 0 0 1 5 15.8V11a5 5 0 0 1 2-5Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <circle cx="11" cy="13.5" r="1.35" fill="currentColor" />
        <circle cx="16" cy="13.5" r="1.35" fill="currentColor" />
        <circle cx="21" cy="13.5" r="1.35" fill="currentColor" />
      </svg>
    </span>
  );
}

export function AppShell() {
  const { admin, logout } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: channel } = useQuery({
    queryKey: ["channel"],
    queryFn: () => api<ChannelStatus>("/api/channel"),
    refetchInterval: 20_000,
  });
  const isChat =
    location.pathname.startsWith("/chat") || location.pathname.startsWith("/workbench");

  const page = useMemo(() => {
    if (location.pathname.startsWith("/chat") || location.pathname.startsWith("/workbench")) {
      return { title: "对话工作台", subtitle: "与客户保持顺畅沟通" };
    }
    return TITLES[location.pathname] ?? { title: "iLink 客服", subtitle: "" };
  }, [location.pathname]);

  useEffect(() => {
    const socket = io({ withCredentials: true, transports: ["websocket", "polling"] });
    socket.on("message:new", (payload: { userId: number; message?: { direction?: string; content?: string }; user?: { name?: string } }) => {
      queryClient.invalidateQueries({ queryKey: ["messages", payload.userId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (payload.message?.direction === "inbound") {
        toast(`收到 ${payload.user?.name ?? "客户"} 的新消息`, "info");
      }
    });
    socket.on("customer:updated", () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    });
    socket.on("customer:bound", () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["bind-recent"] });
    });
    socket.on("binding:updated", () => {
      queryClient.invalidateQueries({ queryKey: ["bind-recent"] });
    });
    socket.on("keepalive:run", () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["keepalive"] });
    });
    socket.on("channel:status", () => {
      queryClient.invalidateQueries({ queryKey: ["channel"] });
    });
    return () => {
      socket.disconnect();
    };
  }, [queryClient, toast]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const statusDot = channel?.connected ? "online" : "offline";

  return (
    <div className={`app-shell ${isChat ? "shell-chat" : ""}`}>
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <BrandMark />
          <div className="brand-text">
            <strong>iLink</strong>
            <span>客服中心</span>
          </div>
          <button className="sidebar-close" type="button" onClick={() => setMobileOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <nav className="side-nav">
          <span className="nav-caption">工作台</span>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            >
              <item.icon size={18} strokeWidth={1.9} />
              <span>{item.label}</span>
              {item.to === "/workbench" && channel?.connected ? <i className="nav-dot" /> : null}
            </NavLink>
          ))}
          <span className="nav-caption nav-caption-gap">通道</span>
          {CHANNEL_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            >
              <item.icon size={18} strokeWidth={1.9} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="side-bottom">
          <button type="button" className="channel-card" onClick={() => navigate("/settings/channel")}>
            <span className={`status-dot ${statusDot}`} />
            <span>
              <strong>{channel?.mode === "live" ? "真实通道" : "演示通道"}</strong>
              <small>{channel?.connected ? (channel.running ? "运行中" : "已连接") : "未连接"}</small>
            </span>
            <ChevronDown size={15} className="channel-chevron" />
          </button>
          <div className="side-user">
            <Avatar name={admin?.name ?? "客服"} size={34} />
            <div>
              <strong>{admin?.name ?? "客服管理员"}</strong>
              <small>{admin?.email}</small>
            </div>
          </div>
        </div>
      </aside>

      {mobileOpen ? <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} /> : null}

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu"
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="打开菜单"
            >
              <MessagesSquare size={20} />
            </button>
            <div>
              <h1>{page.title}</h1>
              <p>{page.subtitle}</p>
            </div>
          </div>
          <div className="topbar-right">
            <span className="date-chip">{dayjs().format("M 月 D 日 dddd")}</span>
            <button className="icon-btn topbar-icon" type="button" title="通知">
              <Bell size={19} />
              <i className="notif-dot" />
            </button>
            <div className="profile-wrap">
              <button
                type="button"
                className="profile-btn"
                onClick={() => setProfileOpen((open) => !open)}
              >
                <Avatar name={admin?.name ?? "客服"} size={30} />
                <span className="profile-name">{admin?.name ?? "客服"}</span>
                <ChevronDown size={14} />
              </button>
              {profileOpen ? (
                <>
                  <div className="profile-scrim" onClick={() => setProfileOpen(false)} />
                  <div className="profile-menu">
                    <div className="profile-menu-head">
                      <strong>{admin?.name}</strong>
                      <span>{admin?.email}</span>
                    </div>
                    <button type="button" onClick={handleLogout}>
                      <LogOut size={16} />
                      退出登录
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </header>
        <main
          className={`page ${
            location.pathname.startsWith("/chat") || location.pathname.startsWith("/workbench")
              ? "page-chat"
              : ""
          }`}
        >
          <Outlet />
        </main>
      </div>

      <nav className="mobile-nav">
        {NAV.slice(0, 4).map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className="mobile-nav-item">
            <item.icon size={20} />
            <span>{item.label.slice(0, 2)}</span>
          </NavLink>
        ))}
        <NavLink to="/settings/channel" className="mobile-nav-item">
          <Settings2 size={20} />
          <span>设置</span>
        </NavLink>
      </nav>
    </div>
  );
}
