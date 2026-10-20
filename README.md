# iLink ClawBot 客服通道系统

面向单商家的 ClawBot 客户触达与真人客服后台。按《iLink ClawBot 客服通道系统 产品设计文档 v1.8》实现完整闭环：

- ClawBot 扫码绑定 + 聚合登录身份补齐（默认素颜 suyanw，可切换北辰 beichenwl）
- 客户列表、24 小时 + 10 条双重窗口、实时对话
- 主动推送（含可达性预检与结果回执）
- 保活策略、静默时段、每日上限、cron 定时任务与运行记录
- 文本、图片、文件三类消息的收发与历史回放
- 仪表盘统计与趋势图表
- v1.7 协议细节：40 秒长轮询、client_id 幂等、16KiB 文本分段、错误分类、Redis 共享状态、消息裁剪、Schema 版本化
- v1.8 图片修复：图片 `media.aes_key` 使用 base64(原始 16 字节 key)，并按客户 `baseurl` 推导区域 CDN 节点，修复微信端图片空白
- v1.8 聚合登录：环境变量改为 provider-neutral 的 `OAUTH_*`，旧的 `BEICHEN_*` 仍可读取

开箱即用：默认使用内置的**演示通道**，不需要 iLink 或聚合登录凭证，也能完整体验"生成二维码 → 扫码 → 授权 → 出现在客户列表 → 对话 → 推送 → 保活"的全流程。

## 快速开始

```bash
npm install
cp .env.example .env
npm run seed      # 首次运行：建库 + 写入演示数据
npm run dev       # 同时启动后端 3001 与前端 5173
```

打开 http://localhost:5173 ，使用 `.env` 中的管理员账号登录（默认 `admin@ilink.local` / `admin123456`）。

修改 `.env` 中的 `ADMIN_PASSWORD` 后，运行 `npm run reset-admin` 让新密码生效。想恢复一份干净的演示数据，运行 `npm run seed:reset`。

切换到真实通道后，可运行 `npm run reset-data` 清空演示客户与消息，保留管理员、通道和保活配置。

生产构建：

```bash
npm run build
npm start         # 后端同时托管 web/dist
```

## 演示流程

1. 进入「客户绑定」页，生成专属绑定链接/二维码。
2. 打开绑定页，点击「微信 / QQ 授权登录」，完成演示 OAuth。
3. 页面展示 ClawBot 二维码，点击「模拟扫码」完成第二步绑定。
4. 绑定成功后，客户进入「客户列表」，可进入对话。

仪表盘、推送、保活设置都可直接操作。保活页面的「立即执行检查」会立刻按策略执行，并展示命中与送达结果。

## 接入真实通道

### 1. iLink ClawBot

在 `.env` 设置 `ILINK_MODE=live`，或在「通道设置」切换到真实 iLink 通道。真实通道按客户独立绑定：

1. 在「客户绑定」页生成专属绑定链接/二维码（10 分钟内有效）。
2. 客户打开绑定页，先完成聚合登录；后端创建状态为「待 ClawBot 绑定」的客户记录，但不在客户列表展示。
3. 授权完成后，页面展示 ClawBot 二维码。后端调用 `get_bot_qrcode`，并每 2 秒轮询 `get_qrcode_status`；二维码 3 分钟内有效，过期可刷新。
4. 客户扫码确认后，后端把 `ilink_bot_id`、`baseurl`、`bot_token` 更新到同一客户记录，状态切换为 active，`bound_at`/`last_active_at` 设为当前时间，客户才进入客户列表。

真实模式不再显示「模拟扫码」按钮。每位客户的 `ilink_bot_id` 唯一，`baseurl` 独立保存；服务重启后按客户恢复 `get_updates_buf` 游标。身份授权与 ClawBot 绑定都完成后，客户才可见。

> 平台限制：鸿蒙版微信当前可能不完全支持 ClawBot，请使用 iOS / Android 微信完成扫码绑定。

### v1.7 协议与稳定性细节

- **长轮询超时 40 秒**：服务端长轮询窗口约 35 秒，客户端统一使用 40 秒 HTTP timeout。
- **client_id 幂等**：所有出站消息生成 `ilink:{timestamp_ms}-{uuid8}`，数据库保存 `client_id`，网络重试不会重复投递。
- **16KiB 分段**：文本按 UTF-8 字节切分，单段不超过 16384 字节；每段作为独立消息并消耗 1 条配额。推送编辑区会显示字节数与段数。
- **错误分类**：`-14` 归类为 SessionExpired，保留 social_uid、标记 `session_expired` 并提示重新扫码；配额错误归类为 QuotaExhausted，禁止继续主动发送，等待用户回复。
- **请求头**：所有 iLink POST 携带 `AuthorizationType`、`Authorization`、随机 `X-WECHAT-UIN`、`iLink-App-Id: bot`、`iLink-App-ClientVersion: 65538`。
- **Redis 状态**：游标、context_token、qrcode↔social_uid 映射写入 Redis（数据库保留游标/上下文兜底）；Socket.IO 使用 Redis Adapter。
- **消息裁剪**：默认保留 30 天，最多 10 万条，每 100 次写入检查一次；可用 `MESSAGE_RETENTION_DAYS`、`MESSAGE_MAX_COUNT` 调整。
- **Schema 版本化**：数据库包含 `schema_migrations` 表，启动时执行幂等 migration 并记录版本。

多节点部署需要共享数据库（PostgreSQL/MySQL）和 Redis；当前单机交付使用 SQLite，Redis 状态已接入，横向扩容时替换数据层即可。

### 2. 聚合登录（素颜 / 北辰）

在 `.env` 填写素颜聚合登录后台分配的应用凭证，并把回调地址配置为：

```
${PUBLIC_BASE_URL}/api/oauth/callback
```

```bash
OAUTH_APPID=<素颜 appid>
OAUTH_APPKEY=<素颜 appkey>
OAUTH_LOGIN_TYPE=wx
OAUTH_API_BASE=https://u.suyanw.cn
OAUTH_PROVIDER=suyanw
```

如需继续使用北辰，把 `OAUTH_API_BASE` 改为 `https://u.beichenwl.cn`、`OAUTH_PROVIDER` 改为 `beichenwl`，并填写对应凭证即可。旧变量 `BEICHEN_APPID` / `BEICHEN_APPKEY` / `BEICHEN_LOGIN_TYPE` / `BEICHEN_API_BASE` 仍兼容，`OAUTH_*` 优先。旧授权路径 `/api/oauth/beichen/*` 会自动重定向到新路径，已发出的链接不会 404。

未配置时自动使用内置演示授权页，不会访问外部服务。

如需用真实手机联调，请把 `PUBLIC_BASE_URL` 与 `WEB_ORIGIN` 改成手机可访问的局域网 IP 或 HTTPS 域名，并确保手机与电脑在同一网络。聚合登录正式授权要求 HTTPS 回调地址；本地 `localhost` 只能用于演示授权。

例如 macOS 上先执行 `ipconfig getifaddr en0` 获取局域网 IP，再把 `.env` 改为：

```bash
PUBLIC_BASE_URL=http://192.168.1.23:3001
WEB_ORIGIN=http://192.168.1.23:5173
```

`npm run dev` 已开启 Vite 的局域网监听；手机访问 `http://192.168.1.23:5173` 即可联调。

### 3. 生产注意事项

- 必须修改 `SESSION_SECRET` 与 `ADMIN_PASSWORD`，并为 `ILINK_CREDENTIAL_KEY` 配置 32 字节随机密钥（hex）。
- 使用 HTTPS 域名作为 `PUBLIC_BASE_URL`；聚合登录提供商通常不接受 HTTP 回调。
- 生产环境把 `WEB_ORIGIN` 设为与 `PUBLIC_BASE_URL` 相同的域名（例如 `https://cs.example.com`），否则授权完成后的页面会跳回开发端口。
- SQLite 适用于单机部署。需要多实例时，将数据层替换为 PostgreSQL/MySQL，并把 Socket.IO 换成 Redis Adapter。

## 目录

```
server/   Fastify API、SQLite、iLink 网关、保活调度、Socket.IO
web/      React + Vite 管理后台与客户绑定页
data/     SQLite 数据库（运行时生成）
uploads/  图片消息与上传文件
```

## 设计取舍

- **单商家**：v1 明确不做多租户，所有数据归属一个商家。
- **真实协议优先**：iLink 没有 Webhook，消息通过 `getupdates` 长轮询获取；出站消息必须携带入站消息的 `context_token`。实现遵循真实协议，而不是文档中的示意接口。
- **窗口与配额**：客户每次发言同时重置 24 小时窗口和 10 条配额；任一耗尽即禁止主动发送，保活也计入配额。
- **按客户 Bot**：每位客户扫码得到独立的 `ilink_bot_id` 与 `baseurl`，网关按客户维护长轮询游标和 Bot 凭证。
- **先授权后绑定**：聚合登录回调先创建 `pending_clawbot` 记录；ClawBot 扫码确认后才写入 `ilink_bot_id` 并激活为 `active`，客户列表只展示已激活用户。
- **游标表扩展**：`msg_cursor` 以 `ilink_bot_id` 为唯一键保存每个客户 Bot 的游标；这是按客户独立绑定模型对单行游标表的扩展。
- **身份信息**：头像、昵称只来自聚合登录 OAuth；未完成授权的前台用户不会进入客户列表。
- **媒体消息**：图片和文件先经 AES-128-ECB 加密上传到 iLink 分区 CDN，再以 CDN 返回的媒体元信息发送；图片 `aes_key` 为 base64(原始 key)，文件为 base64(hex key)。
- **定时保活**：`keepalive_schedules` 保存 cron、文案和媒体附件，调度结果写入 `keepalive_runs`，可在保活页查看最近触发记录。

## 主要页面

| 路径 | 说明 |
| --- | --- |
| `/` | 仪表盘：核心指标、7 天趋势、最近对话 |
| `/customers` | 客户列表：搜索、窗口过滤、ClawBot 失效标签、分页 |
| `/workbench` | 对话工作台：实时消息、图片/文件、24 小时 + 10 条倒计时 |
| `/push` | 主动推送：收件人选择、文本/图片/文件、16KiB 分段提示、结果回执 |
| `/keepalive` | 保活设置：时间阈值、配额预警、文案、静默时段、cron 定时任务 |
| `/invite` | 客户绑定：专属二维码、最近绑定记录 |
| `/settings/channel` | 通道状态：演示/真实模式、客户 Bot 数量、协议说明 |
| `/bind` | 客户侧绑定页：先聚合登录授权，再展示 ClawBot 二维码并激活 |

## 验证

```bash
npm run typecheck
npm test
npm run build
```

后端测试覆盖登录鉴权、完整绑定与 OAuth 流程（含旧路径重定向）、24 小时窗口、10 条配额、媒体消息持久化、CDN 区域推导与 aes_key 编码、推送可达性、保活变量与静默时段。
