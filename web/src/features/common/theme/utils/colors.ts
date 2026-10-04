/*
 * Theme colours for inline styles and SVG, where Tailwind classes don't reach (chart lines, bar
 * fills, legend swatches). Each is a CSS variable from styles/app.css, so it follows the light or
 * dark theme. Give them to SVG through `style` (style={{ stroke: COLOR.solar }}): browsers don't
 * all resolve var() in presentation attributes.
 */

const v = (name: string) => `var(--color-${name})`;

export const COLOR = {
  ink: v("ink"),
  fg: v("fg"),
  canvas: v("canvas"),
  inkMuted: v("ink-muted"),
  solar: v("solar"),
  /** Solar as a soft area under its line. */
  solarWash: v("solar-wash"),
  solarDeep: v("solar-deep"),
  battery: v("battery"),
  batteryRing: v("battery-ring"),
  grid: v("grid"),
  pill: v("pill"),
  pillInk: v("pill-ink"),
  batterySoft: v("battery-soft"),
  /** Power from the grid, in the History day chart. */
  fromGrid: v("grey-500"),
  /** Power sent to the grid. */
  export: v("export"),
  /** Grid import and highest use, in History. */
  import: v("import"),
  gridLine: v("grid-line"),
  gridSoft: v("grid-soft"),
  good: v("good"),
  warn: v("warn"),
  bad: v("bad"),
  lilac: v("lilac"),
  /** The collector's raw registers, in Settings → Database. */
  teal: v("teal"),
  link: v("link"),
  /** Quiet bars: grid power, the supply charge, past days. */
  bar: v("bar"),
  /** Quieter still: past bills, empty tracks. */
  barFaint: v("bar-faint"),
  track: v("track"),
  heatBase: v("heat-base"),
} as const;

/** A colour at an opacity, e.g. alpha(COLOR.good, 0.6). */
export const alpha = (color: string, opacity: number) =>
  `color-mix(in srgb, ${color} ${+(opacity * 100).toFixed(1)}%, transparent)`;

/** A heatmap colour: `color` blended into the empty-cell grey; `v` from 0 (least) to 1 (most). */
export const heatColor = (color: string, v: number) =>
  `color-mix(in oklch, ${color} ${Math.round(12 + v * 88)}%, ${COLOR.heatBase})`;
