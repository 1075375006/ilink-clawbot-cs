import crypto from "node:crypto";
import type {
  GetConfigResp,
  GetUpdatesResp,
  GetUploadUrlReq,
  GetUploadUrlResp,
  MessageItem,
  WeixinMessage,
} from "wechat-ilink-client";

export class IlinkSessionExpiredError extends Error {
  readonly code = "SESSION_EXPIRED";
}

export class IlinkQuotaExhaustedError extends Error {
  readonly code = "QUOTA_EXHAUSTED";
}

export class IlinkApiError extends Error {
  readonly ret?: number;
  readonly errcode?: number;
  constructor(message: string, ret?: number, errcode?: number) {
    super(message);
    this.name = "IlinkApiError";
    this.ret = ret;
    this.errcode = errcode;
  }
}

export function newClientId(): string {
  return `ilink:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function randomUin(): string {
  return Buffer.from(String(crypto.randomBytes(4).readUInt32BE(0)), "utf8").toString("base64");
}

function classify(data: {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  message?: string;
}): never {
  const ret = Number(data.ret ?? 0);
  const errcode = Number(data.errcode ?? 0);
  const message = String(data.errmsg ?? data.message ?? "iLink API error");
  if (ret === -14 || errcode === -14) throw new IlinkSessionExpiredError("iLink Bot session expired");
  if (errcode === 10 || /quota|limit|too many|次数|配额|10\s*条/i.test(message)) {
    throw new IlinkQuotaExhaustedError(message);
  }
  throw new IlinkApiError(message, ret, errcode);
}

export class IlinkApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly channelVersion = "1.0.2",
  ) {}

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      Authorization: `Bearer ${this.token}`,
      "X-WECHAT-UIN": randomUin(),
      "iLink-App-Id": "bot",
      "iLink-App-ClientVersion": "65538",
    };
  }

  private baseInfo() {
    return { channel_version: this.channelVersion };
  }

  private async post<T>(
    endpoint: string,
    body: Record<string, unknown>,
    timeoutMs = 15_000,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/ilink/bot/${endpoint}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ ...body, base_info: this.baseInfo() }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      if (!response.ok) {
        throw new IlinkApiError(`iLink ${endpoint} ${response.status}: ${text.slice(0, 200)}`);
      }
    }
    if (!response.ok) {
      throw new IlinkApiError(
        `iLink ${endpoint} ${response.status}: ${String(data.errmsg ?? data.message ?? text).slice(0, 200)}`,
      );
    }
    const ret = Number(data.ret ?? 0);
    const errcode = Number(data.errcode ?? 0);
    if (ret !== 0 || errcode !== 0) {
      classify({
        ret,
        errcode,
        errmsg: String(data.errmsg ?? data.message ?? ""),
      });
    }
    return data as T;
  }

  async getUpdates(
    getUpdatesBuf: string,
    timeoutMs = 40_000,
  ): Promise<GetUpdatesResp> {
    try {
      return await this.post<GetUpdatesResp>(
        "getupdates",
        { get_updates_buf: getUpdatesBuf },
        timeoutMs,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf };
      }
      throw error;
    }
  }

  async sendMessage(msg: WeixinMessage): Promise<Record<string, unknown>> {
    return this.post<Record<string, unknown>>("sendmessage", { msg });
  }

  async sendText(
    toUserId: string,
    text: string,
    contextToken: string,
  ): Promise<string> {
    const clientId = newClientId();
    await this.sendMessage({
      from_user_id: "",
      to_user_id: toUserId,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      context_token: contextToken,
      item_list: [{ type: 1, text_item: { text } }],
    });
    return clientId;
  }

  async sendItems(
    toUserId: string,
    items: MessageItem[],
    contextToken: string,
  ): Promise<string> {
    const clientId = newClientId();
    await this.sendMessage({
      from_user_id: "",
      to_user_id: toUserId,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      context_token: contextToken,
      item_list: items,
    });
    return clientId;
  }

  async getConfig(ilinkUserId: string, contextToken?: string): Promise<GetConfigResp> {
    return this.post<GetConfigResp>("getconfig", {
      ilink_user_id: ilinkUserId,
      context_token: contextToken,
    });
  }

  async sendTyping(
    ilinkUserId: string,
    typingTicket: string,
    status: 1 | 2,
  ): Promise<void> {
    await this.post("sendtyping", {
      ilink_user_id: ilinkUserId,
      typing_ticket: typingTicket,
      status,
    });
  }

  async getUploadUrl(req: GetUploadUrlReq): Promise<GetUploadUrlResp> {
    return this.post<GetUploadUrlResp>("getuploadurl", { ...req });
  }
}

