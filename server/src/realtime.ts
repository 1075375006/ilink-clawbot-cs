import type { Server } from "socket.io";

let io: Server | null = null;

export function setRealtime(server: Server): void {
  io = server;
}

export function emitToAdmins(event: string, payload: unknown): void {
  io?.to("admins").emit(event, payload);
  // Support sessions get conversation events only, never admin settings or binding tokens.
  if (["message:new", "conversation:updated", "conversation:read", "customer:updated", "customer:bound"].includes(event)) {
    io?.to("support").emit(event, payload);
  }
}

export function disconnectSupportAgent(agentId: number): void {
  io?.to(`support:${agentId}`).emit("support:session-revoked");
  io?.in(`support:${agentId}`).disconnectSockets(true);
}

export function emitToAll(event: string, payload: unknown): void {
  io?.emit(event, payload);
}
