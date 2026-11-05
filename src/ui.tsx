import type { ReactNode } from "react";

export type IconName =
  | "home"
  | "system"
  | "clipboard"
  | "notes"
  | "screen"
  | "timer"
  | "weather"
  | "expand"
  | "select"
  | "settings"
  | "close"
  | "copy"
  | "pin"
  | "trash"
  | "back"
  | "plus"
  | "search"
  | "check"
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "heading"
  | "bullet"
  | "ordered"
  | "code"
  | "link"
  | "text"
  | "erase"
  | "chevron";

const PATHS: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="M3 9.5 10 4l7 5.5" />
      <path d="M5 8.5V16h10V8.5" />
    </>
  ),
  system: <path d="M2 10h3l2-5 3 10 2-6 2 3h4" />,
  clipboard: (
    <>
      <rect x="4" y="4" width="12" height="13" rx="2.5" />
      <path d="M7.5 4V3.2A1.2 1.2 0 0 1 8.7 2h2.6a1.2 1.2 0 0 1 1.2 1.2V4" />
    </>
  ),
  notes: (
    <>
      <rect x="3.5" y="3" width="13" height="14" rx="2.5" />
      <path d="M6.5 7.5h7M6.5 10.5h7M6.5 13.5h4" />
    </>
  ),
  screen: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4.2l2.8 1.6" />
    </>
  ),
  timer: (
    <>
      <circle cx="10" cy="11" r="6.5" />
      <path d="M10 8v3.2l2.2 1.4" />
      <path d="M8 2.5h4" />
    </>
  ),
  weather: (
    <>
      <circle cx="7" cy="6.8" r="3" />
      <path d="M7 2v1.1M2.3 6.8h1.1M3.7 3.4l.8.8M10.3 3.4l-.8.8" />
      <path d="M8.5 16.5h6a2.7 2.7 0 0 0 .3-5.4 3.7 3.7 0 0 0-7-1 3 3 0 0 0 .7 6.4z" />
    </>
  ),
  settings: (
    <>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" />
    </>
  ),
  close: <path d="M6 6l8 8M14 6l-8 8" />,
  copy: (
    <>
      <rect x="7" y="7" width="9" height="9" rx="2" />
      <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" />
    </>
  ),
  pin: <path d="M7 3h6l-1 4 3 3v1H5V10l3-3-1-4ZM10 11v6" />,
  trash: (
    <>
      <path d="M4 6h12M8 6V4h4v2" />
      <path d="M5.5 6l.8 10h7.4l.8-10" />
    </>
  ),
  back: <path d="M12 5l-5 5 5 5" />,
  plus: <path d="M10 4.5v11M4.5 10h11" />,
  search: (
    <>
      <circle cx="9" cy="9" r="5" />
      <path d="M12.6 12.6 16.5 16.5" />
    </>
  ),
  check: <path d="M4.5 10.5 8 14l7.5-8" />,
  bold: <path d="M6.5 4.5h4a3 3 0 0 1 0 6h-4zM6.5 10.5h4.5a3 3 0 0 1 0 6H6.5z" />,
  italic: <path d="M12.5 4.5h-4M11.5 15.5h-4M11 4.5 9 15.5" />,
  underline: <path d="M6 3.5v6a4 4 0 0 0 8 0v-6M5 17h10" />,
  strike: <path d="M4 10h12M6.5 6.5A3 3 0 0 1 10 4.2c1.6 0 3 .8 3 2.3M13.5 13.5c0 1.5-1.4 2.3-3 2.3-1.8 0-3.2-.8-3.4-2.3" />,
  heading: <path d="M5 4.5v11M15 4.5v11M5 10h10" />,
  bullet: (
    <>
      <path d="M8.5 6h8M8.5 10h8M8.5 14h8" />
      <path d="M4.5 6h.01M4.5 10h.01M4.5 14h.01" />
    </>
  ),
  ordered: (
    <>
      <path d="M8.5 6h8M8.5 10h8M8.5 14h8" />
      <path d="M3.4 4.6h.9v2.6M3.2 13.2c.6-.9 1.7-.4 1.7.4 0 .8-1.7 1.2-1.7 2.1h1.8" />
    </>
  ),
  code: <path d="M7.5 6 3.5 10l4 4M12.5 6l4 4-4 4" />,
  link: (
    <>
      <path d="M9 11 11 9" />
      <path d="M8.2 12.2 6.6 13.8a2.6 2.6 0 0 1-3.7-3.7l2-2a2.6 2.6 0 0 1 3.7 0" />
      <path d="M11.8 7.8 13.4 6.2a2.6 2.6 0 0 1 3.7 3.7l-2 2a2.6 2.6 0 0 1-3.7 0" />
    </>
  ),
  text: <path d="M4 6h12M4 10h12M4 14h7" />,
  erase: (
    <>
      <path d="M5 15.5h10" />
      <path d="M6.5 12.5 12 7a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8l-3.3 3.3H6.5z" />
    </>
  ),
  chevron: <path d="M8 5l5 5-5 5" />,
  expand: <path d="M4 8V4h4M16 8V4h-4M4 12v4h4M16 12v4h-4" />,
  select: (
    <>
      <path d="M3.5 7V4.5a1 1 0 0 1 1-1H7M13 3.5h2.5a1 1 0 0 1 1 1V7M16.5 13v2.5a1 1 0 0 1-1 1H13M7 16.5H4.5a1 1 0 0 1-1-1V13" />
      <path d="M7.4 10.2l1.8 1.8 3.4-3.9" />
    </>
  ),
};

export function Icon({
  name,
  size = 18,
  stroke = 1.6,
}: {
  name: IconName;
  size?: number;
  stroke?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}

/** Ring dial. Fixed box + centred number, so a row of them lines up exactly. */
export function Ring({
  value,
  label,
  tone = "accent",
  size = 44,
}: {
  value: number;
  label: string;
  tone?: "accent" | "white" | "dim";
  size?: number;
}) {
  const stroke = 3.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="ring">
      <div className="ring-dial" style={{ width: size, height: size }}>
        <svg width={size} height={size} className={`ring-svg tone-${tone}`}>
          <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            className="ring-fill"
            strokeWidth={stroke}
            strokeDasharray={c}
            strokeDashoffset={c - (pct / 100) * c}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <span className="ring-mid">{Math.round(pct)}</span>
      </div>
      <span className="ring-label">{label}</span>
    </div>
  );
}

export function Spark({
  data,
  max,
  height = 34,
  tone = "accent",
}: {
  data: number[];
  max?: number;
  height?: number;
  tone?: "accent" | "white" | "dim";
}) {
  const w = 100;
  const hi = Math.max(max ?? 0, ...data, 1);
  const pts = data.map((v, i) => {
    const x = (i / Math.max(1, data.length - 1)) * w;
    const y = height - (v / hi) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const area = `0,${height} ${pts.join(" ")} ${w},${height}`;
  return (
    <svg
      className={`spark tone-${tone}`}
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
    >
      <g className="spark-grid">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={w} y1={height * f} y2={height * f} />
        ))}
      </g>
      <polygon points={area} className="spark-area" />
      {pts.length > 1 && (
        <polyline
          points={pts.join(" ")}
          fill="none"
          strokeWidth="1.6"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export function Bar({ value, max, tone = "accent" }: { value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={`bar tone-${tone}`}>
      <div className="bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
