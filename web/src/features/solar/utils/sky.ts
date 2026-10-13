import type { WeatherHour } from "~/features/weather/types";

/*
 * The Solar page's sky: its colours through the day, the weather in it, and where the sun and moon are. Pure maths,
 * so the scene can be drawn at any moment of the day (now, or wherever the day's been scrubbed to).
 */

/** The weather at a moment: how cloudy (0 to 1), how wet (0 to 1), how stormy (0 to 1). */
export type SkyWeather = { cover: number; rain: number; storm: number };

export type Rgb = [number, number, number];

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const rgb = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const mix = (a: Rgb, b: Rgb, k: number): Rgb => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * k) as Rgb;
export const css = (c: Rgb) => `rgb(${c.map(Math.round).join(",")})`;
export const cssA = (c: Rgb, a: number) => `rgba(${c.map(Math.round).join(",")},${a.toFixed(2)})`;

/** How wet a WMO weather code is (with the hour's rain in mm to back it up), and whether it's a thunderstorm. */
function wetness(code: number | null, precip: number | null): { rain: number; storm: number } {
  const c = code ?? 0;
  let rain = 0;
  if (c >= 95) rain = 1;
  else if (c >= 80 && c <= 82) rain = [0.45, 0.7, 1][c - 80];
  else if (c >= 61 && c <= 67) rain = c >= 65 ? 1 : c >= 63 ? 0.7 : 0.45;
  else if (c >= 51 && c <= 57) rain = 0.25;
  if (precip != null && precip > 0.1) rain = Math.max(rain, clamp01(precip / 4));
  return { rain, storm: c >= 95 ? 1 : 0 };
}

/** Eases 0 to 1 in and out, so the weather drifts between hours rather than stepping. */
const ease = (k: number) => k * k * (3 - 2 * k);

/**
 * The weather at `ts`, eased between the middles of the hours around it, so cloud builds and rain sets in smoothly as
 * the day's scrubbed. A fair sky when there's no weather.
 */
export function weatherAt(hours: WeatherHour[] | undefined, ts: number): SkyWeather {
  const pts = (hours ?? []).map((h) => ({
    t: h.ts + 1800,
    cover: clamp01((h.cloud ?? 20) / 100),
    ...wetness(h.code, h.precip),
  }));
  if (!pts.length) return { cover: 0.15, rain: 0, storm: 0 };
  if (ts <= pts[0].t) return pts[0];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (ts < b.t) {
      const k = ease((ts - a.t) / (b.t - a.t));
      return {
        cover: a.cover + (b.cover - a.cover) * k,
        rain: a.rain + (b.rain - a.rain) * k,
        storm: a.storm + (b.storm - a.storm) * k,
      };
    }
  }
  return pts[pts.length - 1];
}

/** The sky's colours (top, middle, horizon) at hours of a standard day: sunrise 5:42, noon, sunset 6:24. */
const KEYS: [number, string, string, string][] = [
  [0, "#04060d", "#0a1024", "#0e1530"],
  [4.8, "#060914", "#151a3c", "#2c2350"],
  [5.7, "#111b40", "#4b3d70", "#d27a58"],
  [7.2, "#163a74", "#3c6eab", "#9dc1dc"],
  [12, "#0f3d7d", "#2e6aae", "#80b3de"],
  [15.6, "#1a447e", "#4a72a6", "#d8b484"],
  [17.4, "#24295b", "#7b4f78", "#f2985a"],
  [18.4, "#141a3d", "#3c2a52", "#a9566a"],
  [19.4, "#070b1a", "#10163a", "#1b2249"],
  [24, "#04060d", "#0a1024", "#0e1530"],
];

/**
 * Where the day is (hours since midnight) mapped onto that standard day, so the sky's colours follow the real sunrise,
 * noon and sunset whatever the season.
 */
export function standardHour(h: number, rise: number, set: number): number {
  const noon = (rise + set) / 2;
  const span = (h0: number, h1: number, s0: number, s1: number) => s0 + ((h - h0) / (h1 - h0)) * (s1 - s0);
  if (h < rise) return span(0, rise, 0, 5.7);
  if (h < noon) return span(rise, noon, 5.7, 12);
  if (h < set) return span(noon, set, 12, 18.4);
  return span(set, 24, 18.4, 24);
}

/** The sky at a standard hour, greyed by cloud and darkened by storm: [top, middle, horizon]. */
export function skyColours(std: number, w: SkyWeather): [Rgb, Rgb, Rgb] {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= std) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const k = clamp01((std - a[0]) / (b[0] - a[0]));
  const grey = rgb("#3a414c");
  const dark = rgb("#15181d");
  return ([1, 2, 3] as const).map((j, n) => {
    const c = mix(mix(rgb(a[j]), rgb(b[j]), k), grey, w.cover * (n === 0 ? 0.3 : 0.55));
    return mix(c, dark, w.storm * 0.5);
  }) as [Rgb, Rgb, Rgb];
}

/** The moon's age through its month: 0 new, 0.5 full (from the new moon of 6 January 2000, 18:14 UTC). */
export function moonAge(ts: number): number {
  const days = ts / 86_400 - 10_962.7597;
  return (((days / 29.530588853) % 1) + 1) % 1;
}

/** How much of the moon's face is lit, 0 to 1. */
export const moonLit = (age: number) => (1 - Math.cos(2 * Math.PI * age)) / 2;

/**
 * The moon's face as a shadow over a disc `size` across: the lit side grows from one edge to full and shrinks back to
 * the other. From the southern hemisphere a waxing moon is lit on the left.
 */
export function moonFace(age: number, size: number, south: boolean): { background: string; boxShadow: string } {
  const lit = moonLit(age);
  const waxing = age < 0.5;
  const litLeft = waxing === south;
  const LIGHT = "#f2eedf";
  const DARK = "rgba(18,22,38,0.92)";
  if (lit <= 0.5) {
    // A crescent: a dark disc with a lit band along one edge.
    const band = size * lit * 1.1;
    return { background: DARK, boxShadow: `inset ${litLeft ? band : -band}px 0 0 0 ${LIGHT}` };
  }
  // Gibbous: a lit disc with a dark band along the other edge.
  const band = size * (1 - lit) * 1.1;
  return { background: LIGHT, boxShadow: `inset ${litLeft ? -band : band}px 0 0 0 ${DARK}` };
}

/** Cloud banks: across the scene from the left, at `top`% down, `scale`, shown from `from` cover, by layer and shape. */
export type CloudBank = {
  top: number;
  scale: number;
  from: number;
  layer: "far" | "near" | "scud";
  shape: 0 | 1 | 2;
  secs: number;
  start: number;
};

export const CLOUDS: CloudBank[] = [
  { top: 3, scale: 0.7, from: 0.02, layer: "far", shape: 1, secs: 230, start: 0.1 },
  { top: 9, scale: 0.9, from: 0.28, layer: "far", shape: 0, secs: 190, start: 0.45 },
  { top: 1, scale: 0.6, from: 0.2, layer: "far", shape: 2, secs: 260, start: 0.72 },
  { top: 13, scale: 0.8, from: 0.45, layer: "far", shape: 1, secs: 210, start: 0.92 },
  { top: 6, scale: 0.75, from: 0.6, layer: "far", shape: 0, secs: 240, start: 0.3 },
  { top: 11, scale: 0.7, from: 0.75, layer: "far", shape: 2, secs: 200, start: 0.6 },
  { top: 18, scale: 1.5, from: 0.03, layer: "near", shape: 0, secs: 105, start: 0.15 },
  { top: 26, scale: 1.3, from: 0.06, layer: "near", shape: 2, secs: 120, start: 0.56 },
  { top: 13, scale: 1.8, from: 0.26, layer: "near", shape: 1, secs: 95, start: 0.82 },
  { top: 30, scale: 1.4, from: 0.36, layer: "near", shape: 0, secs: 115, start: 0.36 },
  { top: 21, scale: 2.0, from: 0.48, layer: "near", shape: 1, secs: 88, start: 0.04 },
  { top: 34, scale: 1.7, from: 0.58, layer: "near", shape: 0, secs: 100, start: 0.7 },
  { top: 27, scale: 2.2, from: 0.7, layer: "near", shape: 1, secs: 90, start: 0.44 },
  { top: 38, scale: 1.9, from: 0.8, layer: "near", shape: 2, secs: 82, start: 0.24 },
  { top: 19, scale: 2.4, from: 0.9, layer: "near", shape: 0, secs: 78, start: 0.9 },
  { top: 40, scale: 1.6, from: 0, layer: "scud", shape: 1, secs: 34, start: 0.2 },
  { top: 47, scale: 1.3, from: 0, layer: "scud", shape: 2, secs: 27, start: 0.62 },
  { top: 36, scale: 1.9, from: 0, layer: "scud", shape: 1, secs: 40, start: 0.86 },
];

/** Raindrops, the same every time (a seeded spread): where across, how long, how fast, and from what rain they show. */
export const DROPS = (() => {
  let s = 7;
  const r = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  return Array.from({ length: 90 }, (_, i) => {
    const near = i % 3 === 0;
    return {
      x: r() * 100,
      len: near ? 26 + r() * 18 : 12 + r() * 12,
      secs: near ? 0.5 + r() * 0.15 : 0.75 + r() * 0.25,
      delay: -r() * 1.2,
      from: r() * 0.9,
      near,
    };
  });
})();
