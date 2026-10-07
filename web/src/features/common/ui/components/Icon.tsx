import type { SVGProps } from "react";
import { COLOR } from "~/features/common/theme/utils/colors";

// Lucide icon paths, as used in the design.
type Shape =
  ["path", { d: string }] | ["circle", { cx: number; cy: number; r: number }] | ["rect", Record<string, number>];
const P = (d: string): Shape => ["path", { d }];

const ICONS = {
  sun: [
    ["circle", { cx: 12, cy: 12, r: 4 }],
    ...[
      "M12 2v2",
      "M12 20v2",
      "m4.93 4.93 1.41 1.41",
      "m17.66 17.66 1.41 1.41",
      "M2 12h2",
      "M20 12h2",
      "m6.34 17.66-1.41 1.41",
      "m19.07 4.93-1.41 1.41",
    ].map(P),
  ],
  cloudSun: [
    "M12 2v2",
    "m4.93 4.93 1.41 1.41",
    "M20 12h2",
    "m19.07 4.93-1.41 1.41",
    "M15.947 12.65a4 4 0 0 0-5.925-4.128",
    "M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z",
  ].map(P),
  cloud: [P("M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z")],
  rain: ["M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242", "M16 14v6", "M8 14v6", "M12 16v6"].map(P),
  moon: [P("M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z")],
  home: [
    P("M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"),
    P("M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"),
  ],
  battery: [["rect", { x: 2, y: 7, width: 16, height: 10, rx: 2 }], P("M22 11v2"), P("M11 9.5 8.5 12h3L9 14.5")],
  batteryDraining: [["rect", { x: 2, y: 7, width: 16, height: 10, rx: 2 }], P("M22 11v2"), P("M6 10v4"), P("M10 10v4")],
  grid: ["M12 2v20", "M2 5h20", "M3 3v2", "M7 3v2", "M17 3v2", "M21 3v2", "m19 5-7 7-7-7"].map(P),
  car: [
    P(
      "M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2",
    ),
    ["circle", { cx: 7, cy: 17, r: 2 }],
    P("M9 17h6"),
    ["circle", { cx: 17, cy: 17, r: 2 }],
  ],
  chart: ["M3 3v16a2 2 0 0 0 2 2h16", "M18 17V9", "M13 17V5", "M8 17v-3"].map(P),
  layout: [
    ["rect", { x: 3, y: 3, width: 7, height: 9, rx: 1 }],
    ["rect", { x: 14, y: 3, width: 7, height: 5, rx: 1 }],
    ["rect", { x: 14, y: 12, width: 7, height: 9, rx: 1 }],
    ["rect", { x: 3, y: 16, width: 7, height: 5, rx: 1 }],
  ],
  settings: [
    P(
      "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
    ),
    ["circle", { cx: 12, cy: 12, r: 3 }],
  ],
  check: [P("M20 6 9 17l-5-5")],
  storm: [P("M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973"), P("m13 12-3 5h4l-3 5")],
  dollar: [["circle", { cx: 12, cy: 12, r: 10 }], P("M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"), P("M12 18V6")],
  chevL: [P("m15 18-6-6 6-6")],
  chevR: [P("m9 18 6-6-6-6")],
  plus: [P("M5 12h14"), P("M12 5v14")],
  download: [P("M12 15V3"), P("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"), P("m7 10 5 5 5-5")],
  upload: [P("M12 3v12"), P("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"), P("m17 8-5-5-5 5")],
  pin: [
    P("M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"),
    ["circle", { cx: 12, cy: 10, r: 3 }],
  ],
  pulse: [
    P(
      "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
    ),
  ],
  lock: [["rect", { x: 3, y: 11, width: 18, height: 11, rx: 2 }], P("M7 11V7a5 5 0 0 1 10 0v4")],
  logOut: [P("m16 17 5-5-5-5"), P("M21 12H9"), P("M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4")],
  bell: [
    P("M10.268 21a2 2 0 0 0 3.464 0"),
    P(
      "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",
    ),
  ],
  phone: [["rect", { x: 5, y: 2, width: 14, height: 20, rx: 2 }], P("M12 18h.01")],
  webhook: [
    P("M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"),
    P("m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"),
    P("m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"),
  ],
  calendar: [["rect", { x: 3, y: 4, width: 18, height: 18, rx: 2 }], P("M16 2v4"), P("M8 2v4"), P("M3 10h18")],
  plug: [P("M12 22v-5"), P("M9 8V2"), P("M15 8V2"), P("M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z")],
  tag: [
    P(
      "M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z",
    ),
    ["circle", { cx: 7.5, cy: 7.5, r: 0.5 }],
  ],
  user: [P("M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"), ["circle", { cx: 12, cy: 7, r: 4 }]],
  database: ["M3 5a9 3 0 1 0 18 0a9 3 0 1 0 -18 0", "M3 5v14a9 3 0 0 0 18 0V5", "M3 12a9 3 0 0 0 18 0"].map(P),
  chevD: [P("m6 9 6 6 6-6")],
  panel: [["rect", { x: 3, y: 3, width: 18, height: 18, rx: 2 }], P("M9 3v18")],
  washer: [
    P("M3 6h3"),
    P("M17 6h.01"),
    ["rect", { x: 3, y: 2, width: 18, height: 20, rx: 2 }],
    ["circle", { cx: 12, cy: 13, r: 5 }],
    P("M12 18a2.5 2.5 0 0 0 0-5 2.5 2.5 0 0 1 0-5"),
  ],
  dryer: [
    P("M3 6h18"),
    P("M7 4h.01"),
    ["rect", { x: 3, y: 2, width: 18, height: 20, rx: 2 }],
    ["circle", { cx: 12, cy: 14, r: 5 }],
    P("M10.5 12.5c.8.8.8 2.2 0 3"),
    P("M13.5 12.5c.8.8.8 2.2 0 3"),
  ],
  dishwasher: [
    ["rect", { x: 3, y: 2, width: 18, height: 20, rx: 2 }],
    P("M3 7h18"),
    P("M7 4.5h.01"),
    P("M10 4.5h.01"),
    P("M7 12h10"),
    P("M7 16h10"),
  ],
  fridge: [P("M5 6a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6Z"), P("M5 10h14"), P("M15 7v6")],
  snowflake: ["M2 12h20", "M12 2v20", "m20 16-4-4 4-4", "m4 8 4 4-4 4", "m16 4-4 4-4-4", "m8 20 4-4 4 4"].map(P),
  flame: [
    P(
      "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5Z",
    ),
  ],
  droplet: [P("M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7Z")],
  bolt: [
    P(
      "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14Z",
    ),
  ],
  flask: [
    P("M10 2v7.53a2 2 0 0 1-.21.9L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.07-10.13a2 2 0 0 1-.21-.9V2"),
    P("M8.5 2h7"),
    P("M7 16h10"),
  ],
  clock: [["circle", { cx: 12, cy: 12, r: 10 }], P("M12 6v6l4 2")],
  code: [P("m16 18 6-6-6-6"), P("m8 6-6 6 6 6")],
  pause: [
    ["rect", { x: 14, y: 4, width: 4, height: 16, rx: 1 }],
    ["rect", { x: 6, y: 4, width: 4, height: 16, rx: 1 }],
  ],
  shield: [
    P(
      "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
    ),
  ],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;

type Props = { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">;

export function Icon({ name, size = 22, style, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", flex: "none", ...style }}
      {...rest}
    >
      {(ICONS[name] as Shape[]).map(([Tag, attrs], i) => (
        <Tag key={i} {...attrs} />
      ))}
    </svg>
  );
}

/** The lightning-bolt brand mark. */
export function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={(size * 20) / 18} viewBox="0 0 16 18" aria-hidden="true" style={{ display: "block" }}>
      <path
        d="M9.6 0.8 L2.2 10.2 H7.4 L6.4 17.2 L13.8 7.8 H8.6 Z"
        strokeLinejoin="round"
        style={{ fill: COLOR.solar }}
      />
    </svg>
  );
}
