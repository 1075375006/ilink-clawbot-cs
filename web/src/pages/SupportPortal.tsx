import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  SupportAuthProvider,
  useSupportAuth,
} from "../store/SupportAuthContext";
import { SupportLoginPage } from "./SupportLoginPage";
import { SupportChatPage } from "./SupportChatPage";
import "../support.css";

function ProtectedSupport({ children }: { children: ReactNode }) {
  const { agent, loading } = useSupportAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="splash">
        <span className="splash-logo">iLink 客服</span>
        <span className="splash-bar" />
      </div>
    );
  if (!agent)
    return (
      <Navigate
        to="/support/login"
        replace
        state={{ from: location.pathname }}
      />
    );
  return <>{children}</>;
}

export function SupportPortal() {
  return (
    <SupportAuthProvider>
      <Routes>
        <Route path="login" element={<SupportLoginPage />} />
        <Route
          path="chat"
          element={
            <ProtectedSupport>
              <SupportChatPage />
            </ProtectedSupport>
          }
        />
        <Route
          path="chat/:id"
          element={
            <ProtectedSupport>
              <SupportChatPage />
            </ProtectedSupport>
          }
        />
        <Route path="*" element={<Navigate to="/support/chat" replace />} />
      </Routes>
    </SupportAuthProvider>
  );
}
