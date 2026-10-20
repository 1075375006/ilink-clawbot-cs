import { useMemo, useState } from "react";
import { dayjs } from "../../lib/format";

interface Props {
  data: Array<{ date: string; value: number }>;
  color?: string;
  height?: number;
  suffix?: string;
}

export function TrendChart({ data, color = "#2E86AB", height = 240, suffix = "人" }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const pad = { top: 18, right: 18, bottom: 34, left: 40 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(4, ...data.map((item) => item.value));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const points = useMemo(
    () =>
      data.map((item, index) => ({
        x: pad.left + (data.length === 1 ? innerW / 2 : (index / (data.length - 1)) * innerW),
        y: pad.top + innerH - (item.value / top) * innerH,
        ...item,
      })),
    [data, innerH, innerW, top, pad.left, pad.top],
  );

  const linePath = points
    .map((point, index) => {
      if (index === 0) return `M ${point.x} ${point.y}`;
      const prev = points[index - 1]!;
      const cpx = (prev.x + point.x) / 2;
      return `C ${cpx} ${prev.y}, ${cpx} ${point.y}, ${point.x} ${point.y}`;
    })
    .join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1]?.x ?? 0} ${pad.top + innerH} L ${points[0]?.x ?? 0} ${pad.top + innerH} Z`;
  const active = hover != null ? points[hover] : null;

  return (
    <div className="chart" style={{ height }}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="绑定用户趋势">
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".2" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {Array.from({ length: 5 }, (_, index) => {
          const y = pad.top + (index / 4) * innerH;
          const value = top - index * step;
          return (
            <g key={index}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y}
                y2={y}
                stroke="#E9EEF5"
                strokeWidth="1"
                strokeDasharray={index === 4 ? "0" : "4 5"}
              />
              <text x={pad.left - 10} y={y + 4} textAnchor="end" className="chart-label">
                {value}
              </text>
            </g>
          );
        })}
        <path d={areaPath} fill="url(#trendFill)" />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" className="chart-line" />
        {points.map((point, index) => (
          <g key={point.date}>
            <text
              x={point.x}
              y={height - 10}
              textAnchor="middle"
              className="chart-label"
            >
              {dayjs(point.date).format("MM/DD")}
            </text>
            <circle
              cx={point.x}
              cy={point.y}
              r={hover === index ? 5 : 3.2}
              fill="#fff"
              stroke={color}
              strokeWidth="2"
            />
            <text
              x={point.x}
              y={Math.max(10, point.y - 10)}
              textAnchor="middle"
              className="chart-value"
            >
              {point.value}
            </text>
            <rect
              x={point.x - innerW / data.length / 2}
              y={pad.top}
              width={innerW / data.length}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            />
          </g>
        ))}
        {active ? (
          <line
            x1={active.x}
            x2={active.x}
            y1={pad.top}
            y2={pad.top + innerH}
            stroke={color}
            strokeOpacity=".18"
            strokeDasharray="4 4"
          />
        ) : null}
      </svg>
      <div
        className="chart-float"
        style={
          active
            ? {
                left: `${(active.x / width) * 100}%`,
                top: `${(active.y / height) * 100}%`,
              }
            : { display: "none" }
        }
        onMouseLeave={() => setHover(null)}
      >
        <span>{dayjs(active?.date).format("M 月 D 日")}</span>
        <strong>
          {active?.value}
          {suffix}
        </strong>
      </div>
    </div>
  );
}
