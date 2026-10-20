/**
 * WeChat iLink image media wire format.
 *
 * `media.aes_key` must be base64 of the 32-char lowercase hex representation of
 * the 16-byte key. base64(raw key bytes) can upload successfully but the image
 * renders blank in WeChat.
 */
export function encodeImageAesKey(aeskey: Buffer): string {
  return Buffer.from(aeskey.toString("hex"), "ascii").toString("base64");
}
