import { useState } from "react";
import { dayjs } from "../../lib/format";

interface Props {
  data: Array<{ date: string; inbound: number; outbound: number }>;
  height?: number;
}

export function BarChart({ data, height = 240 }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 520;
  const pad = { top: 18, right: 10, bottom: 34, left: 34 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(4, ...data.map((item) => item.inbound + item.outbound));
  const rounded = Math.ceil(max / 4) * 4;
  const slot = innerW / Math.max(1, data.length);
  const barW = Math.min(16, slot * 0.26);
  const active = hover != null ? data[hover] : null;
  const activeX = hover != null ? pad.left + slot * hover + slot / 2 : 0;

  return (
    <div className="chart" style={{ height }}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="消息量">
        {Array.from({ length: 5 }, (_, index) => {
          const y = pad.top + (index / 4) * innerH;
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
              <text x={pad.left - 8} y={y + 4} textAnchor="end" className="chart-label">
                {rounded - index * (rounded / 4)}
              </text>
            </g>
          );
        })}
        {data.map((item, index) => {
          const x = pad.left + slot * index + slot / 2;
          const inboundH = (item.inbound / rounded) * innerH;
          const outboundH = (item.outbound / rounded) * innerH;
          return (
            <g key={item.date} onMouseEnter={() => setHover(index)}>
              <rect
                x={x - barW - 2}
                y={pad.top + innerH - inboundH}
                width={barW}
                height={Math.max(2, inboundH)}
                rx={barW / 2.6}
                fill={hover === index ? "#1A3A5C" : "#1A3A5C"}
              />
              <rect
                x={x + 2}
                y={pad.top + innerH - outboundH}
                width={barW}
                height={Math.max(2, outboundH)}
                rx={barW / 2.6}
                fill={hover === index ? "#2E86AB" : "#4FA3C7"}
              />
              <text
                x={x}
                y={Math.max(10, pad.top + innerH - Math.max(inboundH, outboundH) - 5)}
                textAnchor="middle"
                className="chart-value"
              >
                {item.inbound + item.outbound}
              </text>
              <text x={x} y={height - 10} textAnchor="middle" className="chart-label">
                {dayjs(item.date).format("MM/DD")}
              </text>
              <rect
                x={x - slot / 2}
                y={pad.top}
                width={slot}
                height={innerH}
                fill="transparent"
              />
            </g>
          );
        })}
      </svg>
      <div
        className="chart-float chart-float-bar"
        style={
          active
            ? { left: `${(activeX / width) * 100}%`, top: "16%" }
            : { display: "none" }
        }
      >
        <span>{dayjs(active?.date).format("M 月 D 日")}</span>
        <strong>
          收 {active?.inbound ?? 0} · 发 {active?.outbound ?? 0}
        </strong>
      </div>
    </div>
  );
}
