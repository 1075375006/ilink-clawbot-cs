import { ensureBaseConfig, openDatabase } from "./db.js";
import { env } from "./env.js";
import { hashPassword } from "./util/crypto.js";
import { nowIso } from "./util/time.js";

const db = openDatabase();
ensureBaseConfig(db);
const at = nowIso();
const existing = db.prepare("SELECT id FROM admins WHERE email = ?").get(env.admin.email) as
  | { id: number }
  | undefined;

if (existing) {
  db.prepare("UPDATE admins SET password_hash = ?, name = ?, updated_at = ? WHERE id = ?").run(
    hashPassword(env.admin.password),
    env.admin.name,
    at,
    existing.id,
  );
  console.log(`管理员密码已重置：${env.admin.email}`);
} else {
  db.prepare(
    "INSERT INTO admins (email, password_hash, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(env.admin.email, hashPassword(env.admin.password), env.admin.name, at, at);
  console.log(`管理员已创建：${env.admin.email}`);
}
