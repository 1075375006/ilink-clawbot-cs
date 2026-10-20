import { CDN_BASE_URL } from "wechat-ilink-client";

/** iLink `media.aes_key` wire format for images: base64(raw 16-byte key). */
export function encodeImageAesKey(aeskey: Buffer): string {
  return aeskey.toString("base64");
}

/** iLink file media wire format: base64(hex string of the 16-byte key). */
export function encodeFileAesKey(aeskey: Buffer): string {
  return Buffer.from(aeskey.toString("hex"), "ascii").toString("base64");
}

/**
 * iLink allocates API hosts per region. The CDN upload token is bound to the
 * matching regional CDN node, so uploading to the hard-coded default node can
 * succeed while the image remains blank in WeChat.
 */
export function cdnBaseUrlForBot(baseUrl: string): string {
  try {
    const hostname = new URL(baseUrl).hostname;
    if (hostname === "ilinkai.weixin.qq.com") return CDN_BASE_URL;
    const region = hostname.match(/^ilinkai-([a-z]+)\.weixin\.qq\.com$/)?.[1];
    if (region) return `https://novac2c-${region}.cdn.weixin.qq.com/c2c`;
  } catch {
    // fall through
  }
  return CDN_BASE_URL;
}
