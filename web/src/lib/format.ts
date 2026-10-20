import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import relativeTime from "dayjs/plugin/relativeTime";
import isToday from "dayjs/plugin/isToday";
import isYesterday from "dayjs/plugin/isYesterday";

dayjs.locale("zh-cn");
dayjs.extend(relativeTime);
dayjs.extend(isToday);
dayjs.extend(isYesterday);

export { dayjs };

export function shortTime(value: string | null): string {
  if (!value) return "—";
  const date = dayjs(value);
  if (date.isToday()) return date.format("HH:mm");
  if (date.isYesterday()) return "昨天";
  return date.format("MM/DD");
}

export function fullTime(value: string | null): string {
  if (!value) return "—";
  return dayjs(value).format("YYYY-MM-DD HH:mm");
}

export function fromNow(value: string | null): string {
  if (!value) return "—";
  return dayjs(value).fromNow();
}

export function duration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function relativeDay(value: string): string {
  const date = dayjs(value);
  if (date.isToday()) return "今天";
  if (date.isYesterday()) return "昨天";
  return date.format("M 月 D 日");
}

export function loginLabel(type: string | null): string {
  if (!type) return "未知来源";
  const map: Record<string, string> = {
    wx: "微信",
    wechat: "微信",
    wechat_mp: "微信公众号",
    qq: "QQ",
    alipay: "支付宝",
    weibo: "微博",
  };
  return map[type] ?? type;
}
