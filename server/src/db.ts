import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { env } from "./env.js";

export type DB = Database.Database;

let database: DB | null = null;

export function openDatabase(file = env.databasePath): DB {
  if (database) return database;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  database = db;
  return db;
}

export function getDb(): DB {
  if (!database) throw new Error("Database has not been opened");
  return database;
}

export function closeDatabase(): void {
  database?.close();
  database = null;
}

export function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name          TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      clawbot_openid          TEXT NOT NULL UNIQUE,
      social_uid              TEXT,
      login_type              TEXT,
      nickname                TEXT,
      remark                  TEXT,
      faceimg                 TEXT,
      status                  TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'bound', 'unbound')),
      last_active_at          TEXT,
      bound_at                TEXT,
      info_updated_at         TEXT,
      context_token           TEXT,
      window_expires_at       TEXT,
      reply_count             INTEGER NOT NULL DEFAULT 0,
      reply_window_started_at TEXT,
      created_at              TEXT NOT NULL,
      updated_at              TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
    CREATE INDEX IF NOT EXISTS idx_users_bound_at ON users(bound_at);
    CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_social_uid
      ON users(social_uid) WHERE social_uid IS NOT NULL;

    CREATE TABLE IF NOT EXISTS messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      direction       TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
      msg_type        TEXT NOT NULL DEFAULT 'text'
                      CHECK (msg_type IN ('text', 'image', 'template', 'system')),
      content         TEXT NOT NULL DEFAULT '',
      media_url       TEXT,
      message_id      TEXT UNIQUE,
      client_id       TEXT,
      content_json    TEXT,
      ilink_msg_id    TEXT UNIQUE,
      is_keepalive    INTEGER NOT NULL DEFAULT 0,
      is_read         INTEGER NOT NULL DEFAULT 0,
      delivery_status TEXT NOT NULL DEFAULT 'sent'
                      CHECK (delivery_status IN ('sent', 'delivered', 'failed', 'queued')),
      error           TEXT,
      sent_at         TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_user_time ON messages(user_id, sent_at);
    CREATE INDEX IF NOT EXISTS idx_messages_time ON messages(sent_at);

    CREATE TABLE IF NOT EXISTS keepalive_config (
      id             INTEGER PRIMARY KEY CHECK (id = 1),
      enabled        INTEGER NOT NULL DEFAULT 1,
      threshold_hours INTEGER NOT NULL DEFAULT 20,
      msg_template   TEXT NOT NULL,
      max_per_day    INTEGER NOT NULL DEFAULT 1,
      silent_start   TEXT NOT NULL DEFAULT '23:00',
      silent_end     TEXT NOT NULL DEFAULT '08:00',
      updated_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS keepalive_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status     TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
      reason     TEXT,
      sent_at    TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_keepalive_logs_time ON keepalive_logs(sent_at);

    CREATE TABLE IF NOT EXISTS binding_sessions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      token         TEXT NOT NULL UNIQUE,
      status        TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'scanned', 'awaiting_oauth', 'completed', 'expired', 'cancelled')),
      openid        TEXT,
      oauth_state   TEXT UNIQUE,
      user_id       INTEGER REFERENCES users(id),
      from_bot      INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      expires_at    TEXT NOT NULL,
      scanned_at    TEXT,
      completed_at  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_binding_status ON binding_sessions(status, created_at);

    CREATE TABLE IF NOT EXISTS channel_config (
      id           INTEGER PRIMARY KEY CHECK (id = 1),
      mode         TEXT NOT NULL DEFAULT 'demo' CHECK (mode IN ('demo', 'live')),
      bot_token    TEXT,
      bot_id       TEXT,
      base_url     TEXT,
      bot_user_id  TEXT,
      cursor       TEXT,
      qrcode_img   TEXT,
      customer_qr_url TEXT,
      connected_at TEXT,
      updated_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS push_campaigns (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      content     TEXT NOT NULL,
      msg_type    TEXT NOT NULL DEFAULT 'text',
      total       INTEGER NOT NULL DEFAULT 0,
      sent        INTEGER NOT NULL DEFAULT 0,
      failed      INTEGER NOT NULL DEFAULT 0,
      skipped     INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS push_recipients (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL REFERENCES push_campaigns(id) ON DELETE CASCADE,
      user_id     INTEGER,
      status      TEXT NOT NULL,
      error       TEXT,
      sent_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS msg_cursor (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      ilink_bot_id    TEXT NOT NULL UNIQUE,
      user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
      get_updates_buf TEXT,
      updated_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      applied_at  TEXT NOT NULL,
      description TEXT NOT NULL
    );
  `);

  // Additive migrations for databases created by earlier builds.
  const channelColumns = db
    .prepare("PRAGMA table_info(channel_config)")
    .all() as Array<{ name: string }>;
  if (!channelColumns.some((column) => column.name === "customer_qr_url")) {
    db.exec("ALTER TABLE channel_config ADD COLUMN customer_qr_url TEXT");
  }

  const addColumn = (table: string, column: string, definition: string) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((entry) => entry.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };

  addColumn("users", "ilink_bot_id", "TEXT");
  addColumn("users", "baseurl", "TEXT");
  addColumn("users", "bot_token", "TEXT");
  addColumn("users", "ilink_user_id", "TEXT");
  addColumn("users", "window_msg_count", "INTEGER NOT NULL DEFAULT 0");
  addColumn("users", "is_active", "INTEGER NOT NULL DEFAULT 1");
  addColumn("users", "get_updates_buf", "TEXT");
  addColumn("users", "account_status", "TEXT");
  addColumn("messages", "consumed_quota", "INTEGER NOT NULL DEFAULT 0");
  addColumn("messages", "message_id", "TEXT");
  addColumn("messages", "client_id", "TEXT");
  addColumn("messages", "content_json", "TEXT");
  addColumn("keepalive_config", "quota_warn_at", "INTEGER NOT NULL DEFAULT 1");
  addColumn("binding_sessions", "qrcode", "TEXT");
  addColumn("binding_sessions", "qrcode_img", "TEXT");
  addColumn("binding_sessions", "poll_baseurl", "TEXT");
  addColumn("binding_sessions", "poll_status", "TEXT");
  addColumn("binding_sessions", "last_poll_at", "TEXT");
  addColumn("binding_sessions", "poll_error", "TEXT");
  addColumn("binding_sessions", "oauth_sent", "INTEGER NOT NULL DEFAULT 0");
  addColumn("binding_sessions", "ilink_bot_id", "TEXT");
  addColumn("binding_sessions", "baseurl", "TEXT");
  addColumn("binding_sessions", "bot_token", "TEXT");
  addColumn("binding_sessions", "ilink_user_id", "TEXT");

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_ilink_bot_id
      ON users(ilink_bot_id) WHERE ilink_bot_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_message_id
      ON messages(message_id) WHERE message_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_id
      ON messages(client_id) WHERE client_id IS NOT NULL;
    UPDATE users SET ilink_bot_id = clawbot_openid
      WHERE ilink_bot_id IS NULL OR ilink_bot_id = '';
    UPDATE messages SET message_id = ilink_msg_id
      WHERE message_id IS NULL AND direction = 'inbound' AND ilink_msg_id IS NOT NULL;
    UPDATE users SET account_status = CASE
      WHEN status = 'bound' THEN 'active'
      WHEN status = 'unbound' THEN 'unbound'
      ELSE 'pending_clawbot'
    END WHERE account_status IS NULL;
  `);

  const usersNeedingQuota = db
    .prepare(
      `SELECT u.id,
        (SELECT COUNT(*) FROM messages m WHERE m.user_id = u.id
          AND m.direction = 'outbound' AND m.delivery_status = 'sent'
          AND m.sent_at > COALESCE(u.last_active_at, '1970-01-01')) AS used
       FROM users u WHERE u.window_msg_count = 0`,
    )
    .all() as Array<{ id: number; used: number }>;
  const backfill = db.prepare("UPDATE users SET window_msg_count = ? WHERE id = ?");
  for (const row of usersNeedingQuota) {
    if (row.used > 0) backfill.run(Math.min(10, row.used), row.id);
  }

  db.prepare(
    `INSERT OR IGNORE INTO schema_migrations (version, applied_at, description)
     VALUES ('20261020_001', ?, 'v1.3 protocol fields, message metadata and Redis-ready state')`,
  ).run(new Date().toISOString());
  db.prepare(
    `INSERT OR IGNORE INTO schema_migrations (version, applied_at, description)
     VALUES ('20261020_002', ?, 'v1.4 document alignment; no schema changes')`,
  ).run(new Date().toISOString());
  db.prepare(
    `INSERT OR IGNORE INTO schema_migrations (version, applied_at, description)
     VALUES ('20261020_003', ?, 'v1.5 document alignment; no schema changes')`,
  ).run(new Date().toISOString());
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface UserRow {
  id: number;
  clawbot_openid: string;
  ilink_bot_id: string | null;
  baseurl: string | null;
  bot_token: string | null;
  ilink_user_id: string | null;
  social_uid: string | null;
  login_type: string | null;
  nickname: string | null;
  remark: string | null;
  faceimg: string | null;
  status: "pending" | "bound" | "unbound";
  last_active_at: string | null;
  bound_at: string | null;
  info_updated_at: string | null;
  context_token: string | null;
  window_expires_at: string | null;
  reply_count: number;
  reply_window_started_at: string | null;
  window_msg_count: number;
  is_active: number;
  get_updates_buf: string | null;
  account_status: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: number;
  user_id: number;
  direction: "inbound" | "outbound";
  msg_type: "text" | "image" | "template" | "system";
  content: string;
  media_url: string | null;
  ilink_msg_id: string | null;
  is_keepalive: number;
  is_read: number;
  delivery_status: "sent" | "delivered" | "failed" | "queued";
  error: string | null;
  consumed_quota: number;
  sent_at: string;
  message_id?: string | null;
  client_id?: string | null;
  content_json?: string | null;
}

export interface KeepaliveConfigRow {
  id: number;
  enabled: number;
  threshold_hours: number;
  msg_template: string;
  max_per_day: number;
  quota_warn_at: number;
  silent_start: string;
  silent_end: string;
  updated_at: string;
}

export interface BindingSessionRow {
  id: number;
  token: string;
  status:
    | "pending"
    | "scanned"
    | "awaiting_oauth"
    | "completed"
    | "expired"
    | "cancelled";
  openid: string | null;
  oauth_state: string | null;
  user_id: number | null;
  from_bot: number;
  created_at: string;
  expires_at: string;
  scanned_at: string | null;
  completed_at: string | null;
  qrcode: string | null;
  qrcode_img: string | null;
  poll_baseurl: string | null;
  poll_status: string | null;
  last_poll_at: string | null;
  poll_error: string | null;
  oauth_sent: number;
  ilink_bot_id: string | null;
  baseurl: string | null;
  bot_token: string | null;
  ilink_user_id: string | null;
}

export interface ChannelRow {
  id: number;
  mode: "demo" | "live";
  bot_token: string | null;
  bot_id: string | null;
  base_url: string | null;
  bot_user_id: string | null;
  cursor: string | null;
  qrcode_img: string | null;
  customer_qr_url: string | null;
  connected_at: string | null;
  updated_at: string;
}

export const DEFAULT_KEEPALIVE_TEMPLATE =
  "您好{nickname_suffix}！有段时间没聊啦～如果还有任何问题，随时告诉我们，我们一直都在。";

/** Configuration rows required even when demo data is disabled. */
export function ensureBaseConfig(db: DB): void {
  const at = new Date().toISOString();
  db.prepare(
    `INSERT INTO keepalive_config
       (id, enabled, threshold_hours, msg_template, max_per_day, silent_start, silent_end, updated_at)
     VALUES (1, 1, 20, ?, 1, '23:00', '08:00', ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(DEFAULT_KEEPALIVE_TEMPLATE, at);
  const mode = env.ilink.mode;
  db.prepare(
    `INSERT INTO channel_config (id, mode, connected_at, updated_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(mode, mode === "demo" ? at : null, at);
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(value), new Date().toISOString());
}

export function displayName(user: Pick<UserRow, "remark" | "nickname" | "social_uid">): string {
  if (user.remark?.trim()) return user.remark.trim();
  if (user.nickname?.trim()) return user.nickname.trim();
  if (user.social_uid) return `${user.social_uid.slice(0, 8)}…`;
  return "未命名客户";
}
