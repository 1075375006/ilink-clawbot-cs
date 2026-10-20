import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  MessageItemType,
  MessageType,
  WeChatClient,
  ApiClient,
  CDN_BASE_URL,
  aesEcbPaddedSize,
  downloadMediaFromItem,
  getMimeFromFilename,
  uploadBufferToCdn,
  type MessageItem,
  type WeixinMessage,
} from "wechat-ilink-client";
import { env } from "../env.js";
import type { ChannelRow, UserRow } from "../db.js";
import { getDb } from "../db.js";
import { decryptSecret, encryptSecret } from "../util/crypto.js";
import { emitToAdmins } from "../realtime.js";
import { IlinkApi, IlinkSessionExpiredError } from "./api.js";
import { cdnBaseUrlForBot, encodeFileAesKey, encodeImageAesKey } from "./media.js";
import { contextTokenKey, cursorKey, redisGet, redisSetEx } from "../redis.js";

export interface InboundImage {
  url: string;
  filePath: string;
}

export interface InboundFile {
  url: string;
  filePath: string;
  name: string;
  size: number;
  mime: string;
}

export interface InboundEvent {
  openid: string;
  text: string;
  images: InboundImage[];
  files: InboundFile[];
  contextToken: string | null;
  ilinkMsgId: string | null;
  messageId: string | null;
  clientId: string | null;
  at: string;
}

type InboundHandler = (event: InboundEvent) => Promise<void>;
type UserInboundHandler = (userId: number, event: InboundEvent) => Promise<void>;

function extensionForImage(head: Buffer): string {
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  if (head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "jpg";
  if (head.subarray(0, 4).toString("ascii") === "RIFF") return "webp";
  if (head.subarray(0, 3).toString("ascii") === "GIF") return "gif";
  return "bin";
}

export class IlinkGateway {
  private client: WeChatClient | null = null;
  private userBots = new Map<
    number,
    { api: IlinkApi; abort: AbortController; token: string; baseUrl: string }
  >();
  private loginClient: ApiClient | null = null;
  private handler: InboundHandler | null = null;
  private userHandler: UserInboundHandler | null = null;
  private starting = false;
  private lastError: string | null = null;
  private lastPollAt: string | null = null;
  private sessionExpired = false;

  setInboundHandler(handler: InboundHandler): void {
    this.handler = handler;
  }

  setUserInboundHandler(handler: UserInboundHandler): void {
    this.userHandler = handler;
  }

  getChannel(): ChannelRow {
    return getDb().prepare("SELECT * FROM channel_config WHERE id = 1").get() as ChannelRow;
  }

  status() {
    const channel = this.getChannel();
    return {
      mode: channel.mode,
      connected: Boolean(
        channel.connected_at && (channel.mode === "demo" || channel.bot_token),
      ) || this.userBots.size > 0,
      running: this.client != null || this.userBots.size > 0,
      userBots: this.userBots.size,
      botId: channel.bot_id,
      baseUrl: channel.base_url,
      connectedAt: channel.connected_at,
      qrcodeImg: channel.qrcode_img,
      lastError: this.lastError,
      lastPollAt: this.lastPollAt,
      sessionExpired: this.sessionExpired,
    };
  }

  async start(): Promise<void> {
    if (this.starting || this.client) return;
    const channel = this.getChannel();
    if (channel.mode !== "live" || !channel.connected_at) return;
    const token = decryptSecret(channel.bot_token);
    if (!token || !channel.bot_id) return;
    this.starting = true;
    this.sessionExpired = false;
    try {
      const client = new WeChatClient({
        baseUrl: channel.base_url || env.ilink.baseUrl,
        token,
        accountId: channel.bot_id,
        channelVersion: env.ilink.channelVersion,
      });
      this.client = client;
      client.on("message", (msg: WeixinMessage) => {
        void this.handleRawMessage(client, msg).catch((error: unknown) => {
          this.lastError = error instanceof Error ? error.message : String(error);
          console.error("[ilink] inbound handling failed:", error);
        });
      });
      client.on("error", (error: Error) => {
        this.lastError = error.message;
        console.error("[ilink] gateway error:", error.message);
      });
      client.on("sessionExpired", () => {
        this.sessionExpired = true;
        this.lastError = "ClawBot 登录已失效，请在通道设置中重新扫码。";
        getDb()
          .prepare("UPDATE channel_config SET connected_at = NULL, updated_at = ? WHERE id = 1")
          .run(new Date().toISOString());
        client.stop();
        this.client = null;
        emitToAdmins("channel:status", this.status());
        console.error("[ilink] session expired");
      });
      client.on("poll", () => {
        this.lastPollAt = new Date().toISOString();
      });
      void client
        .start({
          loadSyncBuf: () => this.getChannel().cursor ?? "",
          saveSyncBuf: (buf: string) => {
            getDb()
              .prepare("UPDATE channel_config SET cursor = ?, updated_at = ? WHERE id = 1")
              .run(buf, new Date().toISOString());
          },
        })
        .catch((error: unknown) => {
          this.lastError = error instanceof Error ? error.message : String(error);
        })
        .finally(() => {
          this.client = null;
        });
      this.lastError = null;
      console.log(`[ilink] gateway started for ${channel.bot_id}`);
      emitToAdmins("channel:status", this.status());
    } finally {
      this.starting = false;
    }
  }

  stop(): void {
    this.userBots.forEach((bot) => bot.abort.abort());
    this.userBots.clear();
    this.client?.stop();
    this.client = null;
  }

  async startUserBot(user: UserRow): Promise<void> {
    const channel = this.getChannel();
    if (channel.mode !== "live" || user.status === "unbound" || !user.is_active) return;
    if (this.userBots.has(user.id)) return;
    const token = decryptSecret(user.bot_token);
    if (!token || !user.baseurl || !user.ilink_bot_id) return;
    const api = new IlinkApi(user.baseurl, token);
    const abort = new AbortController();
    this.userBots.set(user.id, { api, abort, token, baseUrl: user.baseurl });
    if (user.context_token) {
      void redisSetEx(
        contextTokenKey(user.ilink_bot_id, user.ilink_user_id || user.ilink_bot_id),
        user.context_token,
        86_400,
      );
    }
    void this.pollUserBot(user, api, abort.signal);
    emitToAdmins("channel:status", this.status());
  }

  private async pollUserBot(
    user: UserRow,
    api: IlinkApi,
    signal: AbortSignal,
  ): Promise<void> {
    const botId = user.ilink_bot_id ?? `user-${user.id}`;
    let cursor =
      (await redisGet(cursorKey(botId))) ??
      (
        getDb()
          .prepare("SELECT get_updates_buf FROM users WHERE id = ?")
          .get(user.id) as { get_updates_buf: string | null } | undefined
      )?.get_updates_buf ??
      "";
    while (!signal.aborted) {
      let response;
      try {
        response = await api.getUpdates(cursor, 40_000);
        this.lastError = null;
        this.lastPollAt = new Date().toISOString();
      } catch (error) {
        if (error instanceof IlinkSessionExpiredError) {
          this.markSessionExpired(user.id);
          return;
        }
        this.lastError = error instanceof Error ? error.message : String(error);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        continue;
      }
      if (response.get_updates_buf) {
        cursor = response.get_updates_buf;
        const at = new Date().toISOString();
        getDb()
          .prepare("UPDATE users SET get_updates_buf = ?, updated_at = ? WHERE id = ?")
          .run(cursor, at, user.id);
        getDb()
          .prepare(
            `INSERT INTO msg_cursor (ilink_bot_id, user_id, get_updates_buf, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(ilink_bot_id) DO UPDATE SET
               get_updates_buf = excluded.get_updates_buf,
               user_id = excluded.user_id, updated_at = excluded.updated_at`,
          )
          .run(botId, user.id, cursor, at);
        await redisSetEx(cursorKey(botId), cursor, 86_400);
      }
      for (const msg of response.msgs ?? []) {
        try {
          await this.handleUserRawMessage(user.id, msg);
        } catch (error) {
          this.lastError = error instanceof Error ? error.message : String(error);
          console.error("[ilink] user inbound handling failed:", error);
        }
      }
      if (!response.msgs?.length) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  }

  private markSessionExpired(userId: number): void {
    this.lastError = "ClawBot 登录已失效，请客户重新扫码绑定。";
    getDb()
      .prepare(
        `UPDATE users SET is_active = 0, account_status = 'session_expired',
           updated_at = ? WHERE id = ?`,
      )
      .run(new Date().toISOString(), userId);
    const bot = this.userBots.get(userId);
    bot?.abort.abort();
    this.userBots.delete(userId);
    emitToAdmins("customer:updated", { userId });
    emitToAdmins("channel:status", this.status());
  }

  async startAllUserBots(): Promise<void> {
    const users = getDb()
      .prepare(
        `SELECT * FROM users
         WHERE status IN ('pending', 'bound') AND is_active = 1
           AND bot_token IS NOT NULL AND baseurl IS NOT NULL AND ilink_bot_id IS NOT NULL`,
      )
      .all() as UserRow[];
    for (const user of users) {
      await this.startUserBot(user);
    }
  }

  stopUserBot(userId: number): void {
    const bot = this.userBots.get(userId);
    if (!bot) return;
    bot.abort.abort();
    this.userBots.delete(userId);
    emitToAdmins("channel:status", this.status());
  }

  private userApi(user: UserRow): IlinkApi | null {
    const existing = this.userBots.get(user.id);
    if (existing) return existing.api;
    const token = decryptSecret(user.bot_token);
    if (!token || !user.baseurl || !user.ilink_bot_id) return null;
    return new IlinkApi(user.baseurl, token);
  }

  private userTarget(user: UserRow): string {
    return user.ilink_user_id || user.ilink_bot_id || user.clawbot_openid;
  }

  /** Begin bot QR login. Returns the QR payload, not the PNG. */
  async beginLogin(): Promise<{ id: string; qrcode: string; imageContent: string }> {
    const api = new ApiClient({
      baseUrl: env.ilink.baseUrl,
      channelVersion: env.ilink.channelVersion,
    });
    const qr = await api.getQRCode("3");
    if (!qr.qrcode || !qr.qrcode_img_content) {
      throw new Error("iLink 未返回有效的登录二维码，请稍后重试。");
    }
    this.loginClient = api;
    sessionStorage.set(qr.qrcode, api);
    return { id: qr.qrcode, qrcode: qr.qrcode, imageContent: qr.qrcode_img_content };
  }

  /** Poll once for the login result; persists credentials on confirmation. */
  async pollLogin(id: string): Promise<{
    status: "wait" | "scaned" | "confirmed" | "expired" | "missing";
    connected?: boolean;
    message?: string;
    redirectHost?: string;
  }> {
    const api = sessionStorage.get(id);
    if (!api) return { status: "missing" };
    const result = (await api.pollQRCodeStatus(id)) as Awaited<
      ReturnType<ApiClient["pollQRCodeStatus"]>
    > & { redirect_host?: string };
    if ((result.status as string) === "scaned_but_redirect" && result.redirect_host) {
      const host = result.redirect_host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
      sessionStorage.set(
        id,
        new ApiClient({
          baseUrl: `https://${host}`,
          channelVersion: env.ilink.channelVersion,
        }),
      );
      return { status: "scaned", redirectHost: host };
    }
    if (result.status === "confirmed") {
      if (!result.ilink_bot_id || !result.bot_token) {
        return { status: "confirmed", connected: false, message: "登录已确认，但未返回 Bot 凭证。" };
      }
      const now = new Date().toISOString();
      getDb()
        .prepare(
          `UPDATE channel_config SET
             mode = 'live', bot_token = ?, bot_id = ?, base_url = ?, bot_user_id = ?,
             connected_at = ?, updated_at = ?, cursor = '', qrcode_img = NULL
           WHERE id = 1`,
        )
        .run(
          encryptSecret(result.bot_token),
          result.ilink_bot_id,
          result.baseurl || env.ilink.baseUrl,
          result.ilink_user_id ?? null,
          now,
          now,
        );
      sessionStorage.delete(id);
      await this.start();
      return { status: "confirmed", connected: true };
    }
    return { status: result.status };
  }

  async sendText(
    user: UserRow,
    content: string,
    options: { allowPending?: boolean } = {},
  ): Promise<string | null> {
    if (user.status !== "bound" && !options.allowPending) {
      throw new Error("客户尚未完成身份绑定，暂时无法发送消息。");
    }
    const channel = this.getChannel();
    if (channel.mode === "demo") {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return `demo_out_${crypto.randomUUID()}`;
    }
    if (user.account_status === "session_expired") {
      throw new Error("ClawBot 登录已失效，请客户重新扫码绑定。");
    }
    const api = this.userApi(user);
    if (!api) {
      throw new Error("该客户的 ClawBot 通道尚未建立，请重新扫码绑定。");
    }
    const to = this.userTarget(user);
    const token =
      user.context_token ||
      (await redisGet(contextTokenKey(user.ilink_bot_id ?? `user-${user.id}`, to)));
    if (!token) {
      throw new Error("缺少会话上下文，需要客户先发送一条消息。");
    }
    void redisSetEx(
      contextTokenKey(user.ilink_bot_id ?? `user-${user.id}`, to),
      token,
      86_400,
    );
    return api.sendText(to, content, token);
  }

  async sendImage(user: UserRow, filePath: string, caption?: string): Promise<string | null> {
    if (user.status !== "bound") {
      throw new Error("客户尚未完成身份绑定，暂时无法发送消息。");
    }
    const channel = this.getChannel();
    if (channel.mode === "demo") {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return `demo_img_${crypto.randomUUID()}`;
    }
    const api = this.userApi(user);
    if (!api) {
      throw new Error("该客户的 ClawBot 通道尚未建立，请重新扫码绑定。");
    }
    const to = this.userTarget(user);
    const token =
      user.context_token ||
      (await redisGet(contextTokenKey(user.ilink_bot_id ?? `user-${user.id}`, to)));
    if (!token) {
      throw new Error("缺少会话上下文，需要客户先发送一条消息。");
    }
    void redisSetEx(
      contextTokenKey(user.ilink_bot_id ?? `user-${user.id}`, to),
      token,
      86_400,
    );
    const buf = fs.readFileSync(filePath);
    const rawsize = buf.length;
    const rawfilemd5 = crypto.createHash("md5").update(buf).digest("hex");
    const filesize = aesEcbPaddedSize(rawsize);
    const filekey = crypto.randomBytes(16).toString("hex");
    const aeskey = crypto.randomBytes(16);
    const upload = await api.getUploadUrl({
      filekey,
      media_type: 1,
      to_user_id: to,
      rawsize,
      rawfilemd5,
      filesize,
      no_need_thumb: true,
      aeskey: aeskey.toString("hex"),
    });
    if (!upload.upload_param) {
      throw new Error("iLink 未返回图片上传地址。");
    }
    const { downloadParam } = await uploadBufferToCdn({
      buf,
      uploadParam: upload.upload_param,
      filekey,
      cdnBaseUrl: cdnBaseUrlForBot(user.baseurl || env.ilink.baseUrl),
      aeskey,
    });
    const items: MessageItem[] = [];
    if (caption) {
      items.push({ type: MessageItemType.TEXT, text_item: { text: caption } });
    }
    items.push({
      type: MessageItemType.IMAGE,
      image_item: {
        media: {
          encrypt_query_param: downloadParam,
          aes_key: encodeImageAesKey(aeskey),
          encrypt_type: 1,
        },
        mid_size: filesize,
      },
    });
    return api.sendItems(to, items, token);
  }

  async sendTyping(user: UserRow): Promise<void> {
    const channel = this.getChannel();
    if (channel.mode === "demo") return;
    const api = this.userApi(user);
    if (!api) return;
    const to = this.userTarget(user);
    const context =
      user.context_token ||
      (await redisGet(contextTokenKey(user.ilink_bot_id ?? `user-${user.id}`, to))) ||
      undefined;
    if (context) {
      void redisSetEx(
        contextTokenKey(user.ilink_bot_id ?? `user-${user.id}`, to),
        context,
        86_400,
      );
    }
    const config = await api.getConfig(to, context);
    if (config.typing_ticket) await api.sendTyping(to, config.typing_ticket, 1);
  }

  async sendFile(
    user: UserRow,
    filePath: string,
    fileName: string,
    caption?: string,
  ): Promise<string | null> {
    if (user.status !== "bound") {
      throw new Error("客户尚未完成身份绑定，暂时无法发送文件。");
    }
    const channel = this.getChannel();
    if (channel.mode === "demo") {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return `demo_file_${crypto.randomUUID()}`;
    }
    const api = this.userApi(user);
    if (!api) throw new Error("该客户的 ClawBot 通道尚未建立，请重新扫码绑定。");
    const to = this.userTarget(user);
    const token =
      user.context_token ||
      (await redisGet(contextTokenKey(user.ilink_bot_id ?? `user-${user.id}`, to)));
    if (!token) throw new Error("缺少会话上下文，需要客户先发送一条消息。");
    void redisSetEx(
      contextTokenKey(user.ilink_bot_id ?? `user-${user.id}`, to),
      token,
      86_400,
    );
    const buf = fs.readFileSync(filePath);
    const rawsize = buf.length;
    const rawfilemd5 = crypto.createHash("md5").update(buf).digest("hex");
    const filesize = aesEcbPaddedSize(rawsize);
    const filekey = crypto.randomBytes(16).toString("hex");
    const aeskey = crypto.randomBytes(16);
    const upload = await api.getUploadUrl({
      filekey,
      media_type: 3,
      to_user_id: to,
      rawsize,
      rawfilemd5,
      filesize,
      no_need_thumb: true,
      aeskey: aeskey.toString("hex"),
    });
    if (!upload.upload_param) throw new Error("iLink 未返回文件上传地址。");
    const { downloadParam } = await uploadBufferToCdn({
      buf,
      uploadParam: upload.upload_param,
      filekey,
      cdnBaseUrl: cdnBaseUrlForBot(user.baseurl || env.ilink.baseUrl),
      aeskey,
    });
    const items: MessageItem[] = [];
    if (caption) {
      items.push({ type: MessageItemType.TEXT, text_item: { text: caption } });
    }
    items.push({
      type: MessageItemType.FILE,
      file_item: {
        media: {
          encrypt_query_param: downloadParam,
          aes_key: encodeFileAesKey(aeskey),
          encrypt_type: 1,
        },
        file_name: fileName,
        len: String(rawsize),
      },
    });
    return api.sendItems(to, items, token);
  }

  async sendSystemText(user: UserRow, content: string): Promise<void> {
    const channel = this.getChannel();
    if (channel.mode === "demo") return;
    await this.sendText(user, content);
  }

  async downloadImages(items: MessageItem[], cdnBaseUrl = CDN_BASE_URL): Promise<InboundImage[]> {
    const images: InboundImage[] = [];
    for (const item of items) {
      if (item.type !== MessageItemType.IMAGE) continue;
      try {
        const media = await downloadMediaFromItem(item, cdnBaseUrl);
        if (!media) continue;
        const ext = extensionForImage(media.data.subarray(0, 16));
        const folder = path.join(env.uploadDir, "inbound");
        fs.mkdirSync(folder, { recursive: true });
        const name = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`;
        const filePath = path.join(folder, name);
        fs.writeFileSync(filePath, media.data);
        images.push({ url: `/uploads/inbound/${name}`, filePath });
      } catch (error) {
        console.error("[ilink] failed to download inbound image:", error);
      }
    }
    return images;
  }

  async downloadFiles(items: MessageItem[], cdnBaseUrl = CDN_BASE_URL): Promise<InboundFile[]> {
    const files: InboundFile[] = [];
    for (const item of items) {
      if (item.type !== MessageItemType.FILE) continue;
      try {
        const media = await downloadMediaFromItem(item, cdnBaseUrl);
        if (!media) continue;
        const originalName = item.file_item?.file_name || media.fileName || "file.bin";
        const safeName = path.basename(originalName).replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
        const ext = path.extname(safeName) || ".bin";
        const folder = path.join(env.uploadDir, "inbound", "files");
        fs.mkdirSync(folder, { recursive: true });
        const storedName = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
        const filePath = path.join(folder, storedName);
        fs.writeFileSync(filePath, media.data);
        files.push({
          url: `/uploads/inbound/files/${storedName}`,
          filePath,
          name: safeName,
          size: media.data.length,
          mime: getMimeFromFilename(safeName) || "application/octet-stream",
        });
      } catch (error) {
        console.error("[ilink] failed to download inbound file:", error);
      }
    }
    return files;
  }

  private async handleRawMessage(client: WeChatClient, msg: WeixinMessage): Promise<void> {
    if (msg.message_type !== MessageType.USER) return;
    const openid = msg.from_user_id?.trim();
    if (!openid) return;
    const text = WeChatClient.extractText(msg).trim();
    const images = await this.downloadImages(msg.item_list ?? []);
    const files = await this.downloadFiles(msg.item_list ?? []);
    if (!text && images.length === 0 && files.length === 0) return;
    const msgId = msg.message_id
      ? `ilink_${msg.message_id}`
      : msg.client_id
        ? `ilink_${msg.client_id}`
        : null;
    await this.handler?.({
      openid,
      text,
      images,
      files,
      contextToken: msg.context_token ?? null,
      ilinkMsgId: msgId,
      messageId: msg.message_id != null ? String(msg.message_id) : null,
      clientId: msg.client_id ?? null,
      at: msg.create_time_ms
        ? new Date(msg.create_time_ms).toISOString()
        : new Date().toISOString(),
    });
  }

  private async handleUserRawMessage(
    userId: number,
    msg: WeixinMessage,
  ): Promise<void> {
    if (msg.message_type !== MessageType.USER) return;
    const openid = msg.from_user_id?.trim();
    if (!openid) return;
    const text = WeChatClient.extractText(msg).trim();
    const images = await this.downloadImages(
      msg.item_list ?? [],
      cdnBaseUrlForBot(
        (
          getDb()
            .prepare("SELECT baseurl FROM users WHERE id = ?")
            .get(userId) as { baseurl: string | null } | undefined
        )?.baseurl ?? env.ilink.baseUrl,
      ),
    );
    const files = await this.downloadFiles(
      msg.item_list ?? [],
      cdnBaseUrlForBot(
        (
          getDb()
            .prepare("SELECT baseurl FROM users WHERE id = ?")
            .get(userId) as { baseurl: string | null } | undefined
        )?.baseurl ?? env.ilink.baseUrl,
      ),
    );
    if (!text && images.length === 0 && files.length === 0) return;
    const msgId = msg.message_id
      ? `ilink_${userId}_${msg.message_id}`
      : msg.client_id
        ? `ilink_${userId}_${msg.client_id}`
        : null;
    await this.userHandler?.(userId, {
      openid,
      text,
      images,
      files,
      contextToken: msg.context_token ?? null,
      ilinkMsgId: msgId,
      messageId: msg.message_id != null ? String(msg.message_id) : null,
      clientId: msg.client_id ?? null,
      at: msg.create_time_ms
        ? new Date(msg.create_time_ms).toISOString()
        : new Date().toISOString(),
    });
  }
}

const sessionStorage = new Map<string, ApiClient>();

export const gateway = new IlinkGateway();
