import { useState } from "react";

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
}

export function Avatar({ src, name, size = 40, className = "" }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const initial = [...(name || "客")][0] ?? "客";
  return (
    <span
      className={`avatar ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(12, size * 0.38),
        background:
          failed || !src
            ? "linear-gradient(135deg, #315a7d, #1a3a5c)"
            : undefined,
      }}
    >
      {src && !failed ? (
        <img src={src} alt={name} onError={() => setFailed(true)} />
      ) : (
        <span>{initial}</span>
      )}
    </span>
  );
}
