import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  cdnBaseUrlForBot,
  encodeFileAesKey,
  encodeImageAesKey,
} from "../src/ilink/media.js";

describe("iLink media wire format", () => {
  it("keeps image aes_key as base64 of the raw 16-byte key", () => {
    const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    expect(encodeImageAesKey(key)).toBe(key.toString("base64"));
  });

  it("encodes file aes_key as base64 of the hex key string", () => {
    const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const encoded = encodeFileAesKey(key);
    expect(Buffer.from(encoded, "base64").toString("ascii")).toBe(key.toString("hex"));
  });

  it("derives the regional CDN node from the user's baseurl", () => {
    expect(cdnBaseUrlForBot("https://ilinkai.weixin.qq.com")).toBe(
      "https://novac2c.cdn.weixin.qq.com/c2c",
    );
    expect(cdnBaseUrlForBot("https://ilinkai-sh.weixin.qq.com")).toBe(
      "https://novac2c-sh.cdn.weixin.qq.com/c2c",
    );
    expect(cdnBaseUrlForBot("not a url")).toBe(
      "https://novac2c.cdn.weixin.qq.com/c2c",
    );
  });

  it("produces a 16-byte ECB key usable for AES-128", () => {
    const key = crypto.randomBytes(16);
    expect(key).toHaveLength(16);
    expect(encodeImageAesKey(key)).toBe(key.toString("base64"));
  });
});
