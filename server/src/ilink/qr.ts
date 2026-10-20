import { env } from "../env.js";

export interface BindingQr {
  qrcode: string;
  imageContent: string;
}

export interface BindingQrStatus {
  status: "wait" | "scaned" | "confirmed" | "expired" | "scaned_but_redirect";
  redirect_host?: string;
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  baseurl?: string;
}

function timeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

export async function getBindingQr(): Promise<BindingQr> {
  const response = await fetch(
    `${env.ilink.baseUrl.replace(/\/+$/, "")}/ilink/bot/get_bot_qrcode?bot_type=3`,
    {
      headers: { "iLink-App-Id": "bot", "iLink-App-ClientVersion": "65538" },
      signal: timeout(12_000),
    },
  );
  if (!response.ok) {
    throw new Error(`iLink 二维码接口返回 ${response.status}`);
  }
  const data = (await response.json()) as {
    ret?: number;
    qrcode?: string;
    qrcode_img_content?: string;
    errmsg?: string;
  };
  if (data.ret && data.ret !== 0) {
    throw new Error(data.errmsg || `iLink 二维码接口错误 ${data.ret}`);
  }
  if (!data.qrcode || !data.qrcode_img_content) {
    throw new Error("iLink 未返回有效的二维码内容。");
  }
  return { qrcode: data.qrcode, imageContent: data.qrcode_img_content };
}

export async function pollBindingQr(
  qrcode: string,
  baseUrl = env.ilink.baseUrl,
): Promise<BindingQrStatus> {
  const url = `${baseUrl.replace(/\/+$/, "")}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  const response = await fetch(url, {
    headers: { "iLink-App-Id": "bot", "iLink-App-ClientVersion": "65538" },
    signal: timeout(35_000),
  }).catch((error: unknown) => {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      return null;
    }
    throw error;
  });
  if (!response) return { status: "wait" };
  if (!response.ok) {
    throw new Error(`iLink 扫码状态接口返回 ${response.status}`);
  }
  return (await response.json()) as BindingQrStatus;
}
