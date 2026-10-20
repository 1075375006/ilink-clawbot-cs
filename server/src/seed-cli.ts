import { env } from "./env.js";
import { ensureBaseConfig, openDatabase } from "./db.js";
import { seedDemoData } from "./seed.js";

const db = openDatabase();
ensureBaseConfig(db);
const seeded = seedDemoData(db, { force: process.argv.includes("--force") });
console.log(
  seeded
    ? `演示数据已写入：${env.databasePath}`
    : `数据库已有数据，未重复写入：${env.databasePath}`,
);
console.log(`管理员：${env.admin.email}`);
