import type { WeatherHour } from "~/features/weather/types";

/*
 * The Solar page's sky: the weather in it, the day's clock mapped onto a standard day, and the moon's phase. Pure
 * maths, so the scene can be drawn at any moment of the day (now, or wherever the day's been scrubbed to). The look
 * itself is in atmosphere.ts.
 */

/** The weather at a moment: how cloudy (0 to 1), how wet (0 to 1), how stormy (0 to 1). */
export type SkyWeather = { cover: number; rain: number; storm: number };

export type Rgb = [number, number, number];

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export const rgb = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const mix = (a: Rgb, b: Rgb, k: number): Rgb => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * k) as Rgb;
export const css = (c: Rgb) => `rgb(${c.map(Math.round).join(",")})`;
export const cssA = (c: Rgb, a: number) => `rgba(${c.map(Math.round).join(",")},${a.toFixed(3)})`;

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

/**
 * Where the day is (hours since midnight) mapped onto a standard day (sunrise 5:42, noon, sunset 6:24), so the sky's colours follow the real sunrise,
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
export function moonFace(
  age: number,
  size: number,
  south: boolean,
  /** The unlit side: near black in a dark sky, a faint shade of the sky in the light theme's pale one. */
  DARK = "rgba(18,22,38,0.92)",
): { background: string; boxShadow: string } {
  const lit = moonLit(age);
  const waxing = age < 0.5;
  const litLeft = waxing === south;
  const LIGHT = "#f2eedf";
  if (lit <= 0.5) {
    // A crescent: a dark disc with a lit band along one edge.
    const band = size * lit * 1.1;
    return { background: DARK, boxShadow: `inset ${litLeft ? band : -band}px 0 0 0 ${LIGHT}` };
  }
  // Gibbous: a lit disc with a dark band along the other edge.
  const band = size * (1 - lit) * 1.1;
  return { background: LIGHT, boxShadow: `inset ${litLeft ? -band : band}px 0 0 0 ${DARK}` };
}
