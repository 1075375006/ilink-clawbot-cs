import type { Server } from "socket.io";
import { SESSION_COOKIE } from "./auth.js";
import { SUPPORT_COOKIE, resolveSupportSession } from "./support-auth.js";
import { verifySession } from "./util/crypto.js";
import { gateway } from "./ilink/gateway.js";

export function configureRealtimeAuth(io: Server): void {
  io.use((socket, next) => {
    const cookies: Record<string, string> = {};
    for (const part of (socket.handshake.headers.cookie ?? "").split(";")) {
      const index = part.indexOf("=");
      if (index < 1) continue;
      const key = part.slice(0, index).trim();
      try {
        cookies[key] = decodeURIComponent(part.slice(index + 1));
      } catch {
        /* invalid cookie */
      }
    }
    if (socket.handshake.auth.portal === "support") {
      const agent = resolveSupportSession(cookies[SUPPORT_COOKIE]);
      if (!agent) return next(new Error("SUPPORT_UNAUTHORIZED"));
      socket.data.supportAgent = agent;
      socket.data.supportToken = cookies[SUPPORT_COOKIE];
    } else {
      const session = cookies[SESSION_COOKIE]
        ? verifySession(cookies[SESSION_COOKIE])
        : null;
      if (!session) return next(new Error("UNAUTHORIZED"));
      socket.data.admin = session;
    }
    next();
  });

  io.on("connection", (socket) => {
    if (socket.data.supportAgent) {
      socket.join(["support", `support:${socket.data.supportAgent.id}`]);
      // Enforce token expiry even when the connection stays open for a whole shift.
      const expiryCheck = setInterval(() => {
        if (!resolveSupportSession(socket.data.supportToken)) {
          socket.emit("support:session-revoked");
          socket.disconnect(true);
        }
      }, 30_000);
      expiryCheck.unref();
      socket.on("disconnect", () => clearInterval(expiryCheck));
    } else {
      socket.join("admins");
      socket.emit("channel:status", gateway.status());
    }
  });
}
