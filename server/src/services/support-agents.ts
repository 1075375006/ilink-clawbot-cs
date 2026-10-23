import { getDb } from "../db.js";
import { AppError } from "../errors.js";
import { hashPassword } from "../util/crypto.js";
import { disconnectSupportAgent } from "../realtime.js";

export interface SupportAgentRow {
  id: number;
  username: string;
  name: string;
  password_hash: string;
  enabled: number;
  session_version: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export function serializeAgent(row: SupportAgentRow) {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    enabled: Boolean(row.enabled),
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getAgent(id: number): SupportAgentRow {
  const row = getDb()
    .prepare("SELECT * FROM support_agents WHERE id = ?")
    .get(id) as SupportAgentRow | undefined;
  if (!row) throw new AppError(404, "AGENT_NOT_FOUND", "客服账号不存在。");
  return row;
}

export function listAgents() {
  return (
    getDb()
      .prepare("SELECT * FROM support_agents ORDER BY id DESC")
      .all() as SupportAgentRow[]
  ).map(serializeAgent);
}

export function createAgent(input: {
  username: string;
  name: string;
  password: string;
}) {
  const db = getDb();
  const username = input.username.trim().toLowerCase();
  if (
    db.prepare("SELECT id FROM support_agents WHERE username = ?").get(username)
  ) {
    throw new AppError(409, "AGENT_EXISTS", "该登录账号已存在，请更换一个。");
  }
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO support_agents (username, name, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    )
    .run(username, input.name.trim(), hashPassword(input.password), now, now);
  return serializeAgent(getAgent(Number(info.lastInsertRowid)));
}

export function updateAgent(
  id: number,
  input: { name?: string; enabled?: boolean },
) {
  const current = getAgent(id);
  const enabled = input.enabled ?? Boolean(current.enabled);
  const revoked = !enabled && Boolean(current.enabled);
  getDb()
    .prepare(
      `UPDATE support_agents SET name = ?, enabled = ?,
       session_version = session_version + ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      input.name?.trim() ?? current.name,
      Number(enabled),
      Number(revoked),
      new Date().toISOString(),
      id,
    );
  if (revoked) disconnectSupportAgent(id);
  return serializeAgent(getAgent(id));
}

export function resetAgentPassword(id: number, password: string) {
  getAgent(id);
  getDb()
    .prepare(
      `UPDATE support_agents SET password_hash = ?, session_version = session_version + 1,
       updated_at = ? WHERE id = ?`,
    )
    .run(hashPassword(password), new Date().toISOString(), id);
  disconnectSupportAgent(id);
}
