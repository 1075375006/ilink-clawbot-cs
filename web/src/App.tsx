import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { AppShell } from "./components/AppShell";
import { useAuth } from "./store/AuthContext";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { CustomersPage } from "./pages/CustomersPage";
import { ChatPage } from "./pages/ChatPage";
import { PushPage } from "./pages/PushPage";
import { KeepalivePage } from "./pages/KeepalivePage";
import { BindPage } from "./pages/BindPage";
import { MockOAuthPage } from "./pages/MockOAuthPage";
import { InvitePage } from "./pages/InvitePage";
import { ChannelPage } from "./pages/ChannelPage";
import { NotFoundPage } from "./pages/NotFoundPage";

function Protected({ children }: { children: ReactNode }) {
  const { admin, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="splash">
        <span className="splash-logo">iLink</span>
        <span className="splash-bar" />
      </div>
    );
  }
  if (!admin) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/bind" element={<BindPage />} />
      <Route path="/bind/scan/:token" element={<BindPage autoScan />} />
      <Route path="/bind/success" element={<BindPage successView />} />
      <Route path="/mock-oauth" element={<MockOAuthPage />} />
      <Route
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="chat/:id" element={<ChatPage />} />
        <Route path="workbench" element={<ChatPage />} />
        <Route path="workbench/:id" element={<ChatPage />} />
        <Route path="push" element={<PushPage />} />
        <Route path="keepalive" element={<KeepalivePage />} />
        <Route path="invite" element={<InvitePage />} />
        <Route path="settings/channel" element={<ChannelPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
