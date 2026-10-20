const SHANGHAI_TZ = "Asia/Shanghai";
export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

export function nowIso(): string {
  return new Date().toISOString();
}

export function addMs(date: Date | string, ms: number): string {
  const base = typeof date === "string" ? new Date(date) : date;
  return new Date(base.getTime() + ms).toISOString();
}

export function addHours(date: Date | string, hours: number): string {
  return addMs(date, hours * HOUR_MS);
}

export function addMinutes(date: Date | string, minutes: number): string {
  return addMs(date, minutes * 60 * 1000);
}

export function isPast(value: string | null | undefined, at = new Date()): boolean {
  if (!value) return true;
  return new Date(value).getTime() <= at.getTime();
}

/** 24h conversation window ends at last inbound message + 24h. */
export function windowExpiresAt(lastActiveAt: string | null | undefined): string | null {
  if (!lastActiveAt) return null;
  return addHours(lastActiveAt, 24);
}

export function windowRemainingSeconds(
  lastActiveAt: string | null | undefined,
  at = new Date(),
): number {
  if (!lastActiveAt) return 0;
  const expires = new Date(lastActiveAt).getTime() + DAY_MS;
  return Math.max(0, Math.floor((expires - at.getTime()) / 1000));
}

export function isWindowOpen(lastActiveAt: string | null | undefined, at = new Date()): boolean {
  return windowRemainingSeconds(lastActiveAt, at) > 0;
}

/** YYYY-MM-DD in the merchant's operating timezone. */
export function dateKey(value: Date | string = new Date()): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function shanghaiHour(date = new Date()): number {
  const value = new Intl.DateTimeFormat("en-GB", {
    timeZone: SHANGHAI_TZ,
    hour: "2-digit",
    hour12: false,
  }).format(date);
  return Number.parseInt(value, 10) % 24;
}

export function shanghaiMinutes(date = new Date()): number {
  const value = new Intl.DateTimeFormat("en-GB", {
    timeZone: SHANGHAI_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function parseClock(value: string): number {
  const [hRaw, mRaw] = value.split(":");
  const h = Number.parseInt(hRaw ?? "0", 10);
  const m = Number.parseInt(mRaw ?? "0", 10);
  return (Math.min(23, Math.max(0, h)) * 60 + Math.min(59, Math.max(0, m)));
}

/**
 * Whether `date` falls inside the silent window. Supports windows that cross
 * midnight, e.g. 23:00 → 08:00.
 */
export function isSilentNow(
  start: string,
  end: string,
  date = new Date(),
): boolean {
  const startMin = parseClock(start);
  const endMin = parseClock(end);
  if (startMin === endMin) return false;
  const nowMin = shanghaiMinutes(date);
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin;
}

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

export function lastNDateKeys(days: number, from = new Date()): string[] {
  return Array.from({ length: days }, (_, index) =>
    dateKey(new Date(from.getTime() - (days - 1 - index) * DAY_MS)),
  );
}

export function startOfShanghaiDayIso(date = new Date()): string {
  const key = dateKey(date);
  return new Date(`${key}T00:00:00+08:00`).toISOString();
}
