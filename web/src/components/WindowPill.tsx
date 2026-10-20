import { CircleAlert, CircleCheck, CircleOff } from "lucide-react";
import { duration } from "../lib/format";

interface Props {
  seconds: number;
  replyRemaining?: number;
  accountStatus?: string;
  compact?: boolean;
}

export function WindowPill({
  seconds,
  replyRemaining,
  accountStatus,
  compact = false,
}: Props) {
  if (accountStatus === "session_expired") {
    return (
      <span className="pill pill-danger">
        <CircleOff size={13} />
        ClawBot 已失效
      </span>
    );
  }
  if (seconds <= 0) {
    return (
      <span className="pill pill-muted">
        <CircleOff size={13} />
        {compact ? "已关闭" : "窗口已关闭"}
      </span>
    );
  }
  if (replyRemaining !== undefined && replyRemaining <= 3) {
    return (
      <span className="pill pill-warning">
        <CircleAlert size={13} />
        {compact ? `仅剩 ${replyRemaining} 条` : `仅剩 ${replyRemaining} 条配额`}
      </span>
    );
  }
  const hours = Math.max(1, Math.floor(seconds / 3600));
  return (
    <span className="pill pill-success">
      <CircleCheck size={13} />
      {compact ? duration(seconds) : `有效 ${hours}h`}
    </span>
  );
}
