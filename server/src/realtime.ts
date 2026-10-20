import type { Server } from "socket.io";

let io: Server | null = null;

export function setRealtime(server: Server): void {
  io = server;
}

export function emitToAdmins(event: string, payload: unknown): void {
  io?.to("admins").emit(event, payload);
}

export function emitToAll(event: string, payload: unknown): void {
  io?.emit(event, payload);
}
