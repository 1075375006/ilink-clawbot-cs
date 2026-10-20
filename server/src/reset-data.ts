import { ensureBaseConfig, openDatabase } from "./db.js";
import { nowIso } from "./util/time.js";

const db = openDatabase();
ensureBaseConfig(db);

const tx = db.transaction(() => {
  db.exec(`
    DELETE FROM push_recipients;
    DELETE FROM push_campaigns;
    DELETE FROM keepalive_logs;
    DELETE FROM messages;
    DELETE FROM binding_sessions;
    DELETE FROM msg_cursor;
    DELETE FROM users;
    DELETE FROM sqlite_sequence
      WHERE name IN ('users', 'messages', 'push_campaigns', 'keepalive_logs', 'binding_sessions');
  `);
});

tx();
db.prepare(
  `INSERT INTO settings (key, value, updated_at) VALUES ('demo_seed_version', '1', ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
).run(nowIso());
console.log("业务数据已清空，管理员、通道配置和保活配置已保留。");
console.log("如需恢复演示数据，运行 npm run seed:reset");
