import fs from "node:fs";
import path from "node:path";
import type { DB, KeepaliveConfigRow } from "./db.js";
import { DEFAULT_KEEPALIVE_TEMPLATE } from "./db.js";
import { env } from "./env.js";
import { hashPassword } from "./util/crypto.js";
import { addHours, addMinutes, dateKey, nowIso } from "./util/time.js";

interface SeedMessage {
  dir: "inbound" | "outbound";
  text: string;
  minutesBefore: number;
  type?: "text" | "image" | "system";
  keepalive?: boolean;
  unread?: boolean;
}

interface SeedUser {
  name: string;
  topic: string;
  color: [string, string];
  boundDaysAgo: number;
  lastActiveHoursAgo: number;
  status?: "bound" | "pending" | "unbound";
  remark?: string;
  loginType?: string;
  thread: SeedMessage[];
}

const USERS: SeedUser[] = [
  {
    name: "林薇",
    topic: "风衣发货",
    color: ["#6C8CFF", "#3E5EDB"],
    boundDaysAgo: 0,
    lastActiveHoursAgo: 0.4,
    thread: [
      { dir: "inbound", text: "你好，我昨天拍的那件燕麦色风衣，大概什么时候能发货呀？", minutesBefore: 54 },
      { dir: "outbound", text: "您好呀，我看了一下您的订单，仓库今天下午会统一出库，预计明天上午揽收。", minutesBefore: 49 },
      { dir: "inbound", text: "好的～那我周三前能收到吗？地址是杭州。", minutesBefore: 33 },
      { dir: "outbound", text: "杭州一般隔天就到，周三前没问题的。出库后我把单号发给您。", minutesBefore: 28 },
      { dir: "inbound", text: "太好了，谢谢！另外想问下这件会不会很皱，需要先熨一下吗？", minutesBefore: 24, unread: true },
      { dir: "inbound", text: "我平时不太会用挂烫机 😂", minutesBefore: 23, unread: true },
    ],
  },
  {
    name: "陈默",
    topic: "退换货",
    color: ["#F2994A", "#D96C2C"],
    boundDaysAgo: 1,
    lastActiveHoursAgo: 3.2,
    thread: [
      { dir: "inbound", text: "在吗？上周买的鞋子有点磨脚，可以换大一码吗？", minutesBefore: 210 },
      { dir: "outbound", text: "在的，可以的。鞋盒和吊牌都还在吗？在的话我帮您走换码流程。", minutesBefore: 205 },
      { dir: "inbound", text: "都在的，只在家里试穿过一次。", minutesBefore: 198 },
      { dir: "outbound", text: "好的，我这边已经给您登记。稍后把退货地址和换货单号发您，寄回后仓库签收当天就会补发。", minutesBefore: 190 },
      { dir: "inbound", text: "收到啦，那我今天下班去寄。", minutesBefore: 192, unread: true },
    ],
  },
  {
    name: "周屿",
    topic: "尺码咨询",
    color: ["#56CCF2", "#2D9CDB"],
    boundDaysAgo: 2,
    lastActiveHoursAgo: 7.5,
    thread: [
      { dir: "inbound", text: "我身高 178，体重 70kg，衬衫选 L 还是 XL？", minutesBefore: 460 },
      { dir: "outbound", text: "建议选 L，我们这款是微宽松版型，L 的肩宽和胸围都够，穿起来会更利落。", minutesBefore: 452 },
      { dir: "inbound", text: "我肩膀比较宽，会不会紧？", minutesBefore: 440 },
      { dir: "outbound", text: "这款 L 码肩宽 47cm，按您的体型是合适的。如果您喜欢更宽松一点，XL 也可以，就是衣长会多 3cm。", minutesBefore: 431 },
      { dir: "inbound", text: "明白了，那我拍 L。谢谢！", minutesBefore: 450 },
    ],
  },
  {
    name: "苏晴",
    topic: "优惠券",
    color: ["#BB6BD9", "#8E44AD"],
    boundDaysAgo: 2,
    lastActiveHoursAgo: 11,
    thread: [
      { dir: "inbound", text: "请问会员日那个满 300 减 50 的券还能领吗？", minutesBefore: 700 },
      { dir: "outbound", text: "可以的，活动到本周日 24 点。您在小程序首页「会员日」入口就能领。", minutesBefore: 694 },
      { dir: "inbound", text: "领到了！可以和店铺的新客券叠加吗？", minutesBefore: 660, unread: true },
    ],
  },
  {
    name: "郑凯",
    topic: "发票",
    color: ["#27AE60", "#1E8449"],
    boundDaysAgo: 3,
    lastActiveHoursAgo: 14,
    thread: [
      { dir: "inbound", text: "订单 202610180032 可以开公司抬头的专票吗？", minutesBefore: 860 },
      { dir: "outbound", text: "可以。麻烦把公司名称、税号和开户信息发我，我这边提交财务，一般 2 个工作日开出。", minutesBefore: 850 },
      { dir: "inbound", text: "好的，我整理一下发你。", minutesBefore: 840 },
      { dir: "outbound", text: "不急，收到后我会第一时间帮您处理。", minutesBefore: 838 },
    ],
  },
  {
    name: "何晓芸",
    topic: "面料成分",
    color: ["#EB5757", "#C0392B"],
    boundDaysAgo: 3,
    lastActiveHoursAgo: 18.5,
    thread: [
      { dir: "inbound", text: "这款针织开衫含羊毛吗？我皮肤比较敏感。", minutesBefore: 1120 },
      { dir: "outbound", text: "含 30% 羊毛、70% 精梳棉，贴身穿不会扎。敏感肌的话建议里面搭一件薄打底会更舒服。", minutesBefore: 1108 },
      { dir: "inbound", text: "好的，那洗的时候要注意什么？", minutesBefore: 1090 },
      { dir: "outbound", text: "建议冷水手洗或羊毛模式，平铺阴干，不要拧干和暴晒～", minutesBefore: 1080 },
    ],
  },
  {
    name: "顾言",
    topic: "修改地址",
    color: ["#2D9CDB", "#1B6CA8"],
    boundDaysAgo: 4,
    lastActiveHoursAgo: 20.8,
    thread: [
      { dir: "inbound", text: "刚下的单地址写错了，能帮我改到公司吗？", minutesBefore: 1260 },
      { dir: "outbound", text: "可以，订单还没出库。把新地址发我就行。", minutesBefore: 1252 },
      { dir: "inbound", text: "杭州市滨江区江南大道 588 号 A 座 12 楼，收件人还是我。", minutesBefore: 1245 },
      { dir: "outbound", text: "已经改好了，您可以在订单详情里再确认一下。", minutesBefore: 1240 },
      { dir: "inbound", text: "看到了，效率好高，谢谢～", minutesBefore: 1230, unread: true },
    ],
  },
  {
    name: "沈知夏",
    topic: "预售时间",
    color: ["#F2C94C", "#D4A017"],
    boundDaysAgo: 4,
    lastActiveHoursAgo: 21.4,
    thread: [
      { dir: "inbound", text: "预售的羊绒围巾大概什么时候发？", minutesBefore: 1300 },
      { dir: "outbound", text: "这一批是 10 月 25 日统一发货，下单顺序靠前的话当天就能出库。", minutesBefore: 1290 },
      { dir: "inbound", text: "好，那我先拍。能备注晚一点发吗？我下周出差。", minutesBefore: 1280 },
      { dir: "outbound", text: "可以的，给您备注 10 月 28 日之后发货。", minutesBefore: 1270 },
    ],
  },
  {
    name: "吴桐",
    topic: "售后补发",
    color: ["#9B51E0", "#6C2BD9"],
    boundDaysAgo: 5,
    lastActiveHoursAgo: 22.6,
    thread: [
      { dir: "inbound", text: "收到的杯子有一个小缺口，能补发一个吗？", minutesBefore: 1380 },
      { dir: "outbound", text: "抱歉给您添麻烦了。方便拍张照片发我吗？我这边直接安排补发，不用寄回。", minutesBefore: 1374 },
      { dir: "inbound", text: "图片", minutesBefore: 1360, type: "image" },
      { dir: "outbound", text: "看到了，已提交补发，预计 2-3 天到。原件您留着用就好。", minutesBefore: 1350 },
      { dir: "inbound", text: "好的，谢谢你们的处理。", minutesBefore: 1356, unread: true },
    ],
  },
  {
    name: "梁悦",
    topic: "企业团购",
    color: ["#00B8A9", "#00897B"],
    boundDaysAgo: 5,
    lastActiveHoursAgo: 26.5,
    thread: [
      { dir: "inbound", text: "我们公司想团购 80 份伴手礼，有企业价吗？", minutesBefore: 1580 },
      { dir: "outbound", text: "有的，80 份可以走企业团购价，还能定制卡片。方便留个电话吗？我让团购同事对接您。", minutesBefore: 1570 },
      { dir: "inbound", text: "138****6621，姓梁。", minutesBefore: 1560 },
      { dir: "outbound", text: "收到，今天下午会联系您。", minutesBefore: 1555 },
    ],
  },
  {
    name: "唐予安",
    topic: "积分兑换",
    color: ["#F2994A", "#B9770E"],
    boundDaysAgo: 6,
    lastActiveHoursAgo: 30,
    thread: [
      { dir: "inbound", text: "我的积分怎么突然少了 200？", minutesBefore: 1800 },
      { dir: "outbound", text: "帮您查了，是 10 月 15 日兑换了一张 20 元无门槛券，扣了 200 积分。", minutesBefore: 1790 },
      { dir: "inbound", text: "哦哦想起来了，那张券在哪里看？", minutesBefore: 1780 },
      { dir: "outbound", text: "在「我的-优惠券」里，有效期到 11 月 15 日。", minutesBefore: 1770 },
    ],
  },
  {
    name: "许嘉禾",
    topic: "缺货登记",
    color: ["#6FCF97", "#219653"],
    boundDaysAgo: 6,
    lastActiveHoursAgo: 40,
    thread: [
      { dir: "inbound", text: "雾蓝色 M 码还有吗？", minutesBefore: 2400 },
      { dir: "outbound", text: "这个颜色 M 码暂时缺货了，预计下周三补。需要我帮您登记到货提醒吗？", minutesBefore: 2390 },
      { dir: "inbound", text: "麻烦登记一下，谢谢。", minutesBefore: 2380 },
      { dir: "outbound", text: "已登记，到货后第一时间通知您。", minutesBefore: 2375 },
    ],
  },
  {
    name: "江野",
    topic: "已关闭窗口",
    color: ["#828282", "#4F4F4F"],
    boundDaysAgo: 1,
    lastActiveHoursAgo: 32,
    thread: [
      { dir: "inbound", text: "请问周末门店营业到几点？", minutesBefore: 2000 },
      { dir: "outbound", text: "周六周日都营业到晚上 9 点，欢迎过来看看。", minutesBefore: 1990 },
      { dir: "inbound", text: "好，谢谢。", minutesBefore: 1920 },
    ],
  },
  {
    name: "温以宁",
    topic: "待授权",
    color: ["#BDBDBD", "#828282"],
    boundDaysAgo: 0,
    lastActiveHoursAgo: 0.2,
    status: "pending",
    thread: [
      { dir: "inbound", text: "你好，我想咨询一下羽绒服。", minutesBefore: 12 },
      { dir: "outbound", text: "欢迎～为了给您提供更完整的服务，请先完成身份授权。", minutesBefore: 11, type: "system" },
    ],
  },
];

const HISTORY_INBOUND = [
  "请问这款还有别的颜色吗？",
  "大概多久能到上海？",
  "可以开发票吗？",
  "这个和上次买的那个有什么区别？",
  "有活动价吗？",
  "麻烦帮我看看物流。",
  "我尺码拿不准，能帮我推荐吗？",
  "售后电话是多少？",
];
const HISTORY_OUTBOUND = [
  "在的，稍等我帮您确认一下～",
  "已经帮您查到了，马上发您。",
  "可以的，我这边为您登记。",
  "感谢您的耐心等待。",
  "这款目前有现货，下单后 48 小时内发出。",
  "您的问题已经反馈给仓库，有结果第一时间告诉您。",
];

function writeAvatar(dir: string, index: number, name: string, colors: [string, string]): string {
  fs.mkdirSync(dir, { recursive: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${colors[0]}"/>
      <stop offset="100%" stop-color="${colors[1]}"/>
    </linearGradient>
  </defs>
  <rect width="120" height="120" rx="60" fill="url(#g)"/>
  <text x="60" y="78" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif"
    font-size="46" font-weight="600" fill="#fff" opacity=".96">${[...name][0] ?? "客"}</text>
</svg>`;
  const relative = `/uploads/avatars/user-${index + 1}.svg`;
  fs.writeFileSync(path.join(dir, `user-${index + 1}.svg`), svg, "utf8");
  return relative;
}

function writeDemoPhoto(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720" viewBox="0 0 720 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#E8EEF6"/><stop offset="100%" stop-color="#CFDCEA"/>
    </linearGradient>
    <linearGradient id="cup" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#F7F4EF"/><stop offset="100%" stop-color="#DDD6C9"/>
    </linearGradient>
  </defs>
  <rect width="720" height="720" fill="url(#bg)"/>
  <circle cx="360" cy="330" r="220" fill="#FFFFFF" opacity=".55"/>
  <ellipse cx="360" cy="560" rx="190" ry="26" fill="#A9B8C9" opacity=".45"/>
  <path d="M200 250h280v210c0 55-45 100-100 100h-80c-55 0-100-45-100-100z" fill="url(#cup)"/>
  <path d="M480 300h40c45 0 80 35 80 78s-35 78-80 78h-40v-40h36c23 0 42-17 42-38s-19-38-42-38h-36z" fill="url(#cup)"/>
  <ellipse cx="340" cy="250" rx="140" ry="24" fill="#FBF9F5"/>
  <ellipse cx="340" cy="252" rx="118" ry="16" fill="#B98A5C"/>
  <path d="M290 190c0-26 24-26 24-52M340 185c0-26 24-26 24-52M390 190c0-26 24-26 24-52" stroke="#FFFFFF" stroke-width="12" stroke-linecap="round" fill="none" opacity=".75"/>
  </svg>`;
  fs.writeFileSync(path.join(dir, "demo-cup.svg"), svg, "utf8");
}

export function seedDemoData(db: DB, options: { force?: boolean } = {}): boolean {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (existing.n > 0 && !options.force) return false;
  const seededMarker = db
    .prepare("SELECT value FROM settings WHERE key = 'demo_seed_version'")
    .get() as { value: string } | undefined;
  if (seededMarker && !options.force) return false;

  const now = new Date();
  const nowIsoValue = now.toISOString();
  const avatarDir = path.join(env.uploadDir, "avatars");
  writeDemoPhoto(env.uploadDir);

  const admin = db.prepare("SELECT COUNT(*) AS n FROM admins").get() as { n: number };
  if (admin.n === 0) {
    db.prepare(
      "INSERT INTO admins (email, password_hash, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      env.admin.email,
      hashPassword(env.admin.password),
      env.admin.name,
      nowIsoValue,
      nowIsoValue,
    );
  }

  db.prepare(
    `INSERT INTO keepalive_config
       (id, enabled, threshold_hours, msg_template, max_per_day, silent_start, silent_end, updated_at)
     VALUES (1, 1, 20, ?, 1, '23:00', '08:00', ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(DEFAULT_KEEPALIVE_TEMPLATE, nowIsoValue);

  db.prepare(
    `INSERT INTO channel_config (id, mode, connected_at, updated_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(env.ilink.mode, nowIsoValue, nowIsoValue);

  if (options.force) {
    db.exec("DELETE FROM push_recipients; DELETE FROM push_campaigns; DELETE FROM keepalive_logs; DELETE FROM messages; DELETE FROM binding_sessions; DELETE FROM users;");
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('users','messages','push_campaigns','keepalive_logs','binding_sessions')").run();
  }

  const insertUser = db.prepare(
    `INSERT INTO users
      (clawbot_openid, social_uid, login_type, nickname, remark, faceimg, status,
       last_active_at, bound_at, info_updated_at, context_token, window_expires_at,
       reply_count, reply_window_started_at, ilink_bot_id, baseurl, ilink_user_id,
       window_msg_count, is_active, account_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertMessage = db.prepare(
    `INSERT INTO messages
      (user_id, direction, msg_type, content, media_url, ilink_msg_id, is_keepalive,
       is_read, consumed_quota, delivery_status, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?)`,
  );
  const insertKeepalive = db.prepare(
    "INSERT INTO keepalive_logs (user_id, status, reason, sent_at) VALUES (?, ?, ?, ?)",
  );

  const seedAll = db.transaction(() => {
    USERS.forEach((seed, index) => {
      const lastActive = addHours(now, -seed.lastActiveHoursAgo);
      const boundAt = addHours(now, -seed.boundDaysAgo * 24 - (index % 5));
      const avatar = writeAvatar(avatarDir, index, seed.name, seed.color);
      const status = seed.status ?? "bound";
      const socialUid = status === "pending" ? null : `bc_${(10241000 + index * 137).toString(36)}${index}`;
      const openid = `wx_openid_demo_${String(index + 1).padStart(3, "0")}`;
      const contextToken = `ctx_demo_${index + 1}_${dateKey(now)}`;
      const replyCount = seed.thread.filter((m) => m.dir === "outbound").length;

      const info = insertUser.run(
        openid,
        socialUid,
        seed.loginType ?? (index % 4 === 3 ? "qq" : "wx"),
        seed.name,
        seed.remark ?? null,
        status === "pending" ? null : avatar,
        status,
        lastActive,
        status === "pending" ? null : boundAt,
        status === "pending" ? null : addHours(boundAt, 2),
        contextToken,
        addHours(lastActive, 24),
        replyCount,
        lastActive,
        openid,
        "demo",
        openid,
        replyCount,
        status === "bound" ? 1 : 0,
        status === "bound" ? "active" : "pending_clawbot",
        boundAt,
        nowIsoValue,
      );
      const userId = Number(info.lastInsertRowid);

      // Historical volume across the last 7 days for the dashboard.
      for (let day = 6; day >= 1; day -= 1) {
        const count = ((index + day) % 3) + 1;
        for (let n = 0; n < count; n += 1) {
          const minutesAgo = day * 24 * 60 + ((index * 37 + n * 53) % 600);
          const at = addMinutes(now, -minutesAgo);
          const inbound = (index + day + n) % 2 === 0;
          insertMessage.run(
            userId,
            inbound ? "inbound" : "outbound",
            "text",
            inbound
              ? HISTORY_INBOUND[(index + n) % HISTORY_INBOUND.length]
              : HISTORY_OUTBOUND[(day + n) % HISTORY_OUTBOUND.length],
            null,
            `demo_hist_${index}_${day}_${n}`,
            0,
            1,
            inbound ? 0 : 1,
            at,
          );
        }
      }

      for (const message of seed.thread) {
        const at = addMinutes(now, -message.minutesBefore);
        const isImage = message.type === "image";
        insertMessage.run(
          userId,
          message.dir,
          message.type ?? "text",
          message.text,
          isImage ? "/uploads/demo-cup.svg" : null,
          `demo_msg_${index}_${message.minutesBefore}`,
          message.keepalive ? 1 : 0,
          message.unread ? 0 : 1,
          message.dir === "outbound" ? 1 : 0,
          at,
        );
      }

      // A little keepalive history for the dashboard's "today" counters.
      if (index === 4 || index === 7) {
        insertKeepalive.run(userId, "sent", null, addMinutes(now, -(60 + index * 20)));
      }
    });

    // Seed a realistic push history.
    const campaign = db
      .prepare(
        "INSERT INTO push_campaigns (content, msg_type, total, sent, failed, skipped, created_at) VALUES (?, 'text', 12, 10, 1, 1, ?)",
      )
      .run("本周会员日，满 300 减 50，今晚 8 点准时开始～", addHours(now, -22));
    const campaignId = Number(campaign.lastInsertRowid);
    db.prepare(
      "INSERT INTO push_recipients (campaign_id, user_id, status, error, sent_at) VALUES (?, NULL, 'sent', NULL, ?)",
    ).run(campaignId, addHours(now, -22));
  });

  seedAll();
  if (options.force) {
    db.prepare(
      `UPDATE channel_config SET mode = 'demo', connected_at = ?, bot_token = NULL,
         bot_id = NULL, base_url = NULL, bot_user_id = NULL, cursor = NULL,
         qrcode_img = NULL, customer_qr_url = NULL, updated_at = ? WHERE id = 1`,
    ).run(nowIsoValue, nowIsoValue);
  }
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES ('demo_seed_version', '1', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(nowIsoValue);
  return true;
}

export function getKeepaliveConfig(db: DB): KeepaliveConfigRow {
  return db.prepare("SELECT * FROM keepalive_config WHERE id = 1").get() as KeepaliveConfigRow;
}

export function ensureAdmin(db: DB): void {
  const admin = db.prepare("SELECT COUNT(*) AS n FROM admins").get() as { n: number };
  if (admin.n === 0) {
    const at = nowIso();
    db.prepare(
      "INSERT INTO admins (email, password_hash, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(env.admin.email, hashPassword(env.admin.password), env.admin.name, at, at);
  }
}
