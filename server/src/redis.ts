import { Redis } from "ioredis";
import { env } from "./env.js";

let client: Redis | null = null;
let warned = false;

export function getRedis(): Redis {
  if (client) return client;
  client = new Redis(env.redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: true,
    retryStrategy: (times) => Math.min(2_000 * times, 10_000),
  });
  client.on("error", (error: Error) => {
    if (warned) return;
    warned = true;
    console.warn(`[redis] unavailable, using database fallback: ${error.message}`);
  });
  return client;
}

export async function redisGet(key: string): Promise<string | null> {
  try {
    return await getRedis().get(key);
  } catch {
    return null;
  }
}

export async function redisSetEx(key: string, value: string, ttlSeconds: number): Promise<void> {
  try {
    await getRedis().set(key, value, "EX", ttlSeconds);
  } catch {
    // Redis is optional for a single-node development deployment.
  }
}

export async function redisDel(key: string): Promise<void> {
  try {
    await getRedis().del(key);
  } catch {
    // ignore
  }
}

export function cursorKey(botId: string): string {
  return `ilink:cursor:${botId}`;
}

export function contextTokenKey(botId: string, userId: string): string {
  return `ilink:context:${botId}:${userId}`;
}

export function qrMappingKey(qrcode: string): string {
  return `ilink:qrcode:${qrcode}`;
}

export async function setQrMapping(qrcode: string, socialUid: string): Promise<void> {
  await redisSetEx(qrMappingKey(qrcode), socialUid, 300);
}

export async function getQrMapping(qrcode: string): Promise<string | null> {
  return redisGet(qrMappingKey(qrcode));
}

export async function deleteQrMapping(qrcode: string | null | undefined): Promise<void> {
  if (qrcode) await redisDel(qrMappingKey(qrcode));
}
