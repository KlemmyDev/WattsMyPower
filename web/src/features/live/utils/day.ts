import type { HistorySeries } from "~/features/common/readings/types";
import { sunPlace } from "~/features/common/time/utils/sun";
import type { Light, P3 } from "~/features/live/utils/house3d";
import type { Atmosphere } from "~/features/solar/utils/atmosphere";
import { clamp01, type Rgb, type SkyWeather } from "~/features/solar/utils/sky";

/*
 * The live pages' day: readings at a moment of it, lines between points, and the sun's light on the house then.
 */

/** The live pages, which share one top card: going between them flies its camera rather than opening a new page. */
export const LIVE_PAGES = ["solar", "battery"] as const;
export type LivePage = (typeof LIVE_PAGES)[number];

/** The live page at an address, or null. */
export const livePage = (path: string): LivePage | null =>
  (LIVE_PAGES as readonly string[]).find((p) => path === `/${p}` || path === `/${p}/`) as LivePage | null;

/** The reading of `field` nearest `t` in a day's series (within 15 minutes), or null. */
export function seriesAt(series: HistorySeries | undefined, field: string, t: number): number | null {
  const ts = series?.t ?? [];
  const v = series?.[field] ?? [];
  let best: number | null = null;
  let gap = Infinity;
  for (let i = 0; i < ts.length; i++) {
    const d = Math.abs(ts[i] - t);
    if (d < gap && v[i] != null) {
      gap = d;
      best = v[i]!;
    }
  }
  return gap <= 900 ? best : null;
}

export type Pt = { t: number; v: number | null };

/** What a line of points says at `t`, between its points; null outside it. */
export function valueAt(pts: Pt[], t: number): number | null {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (t >= a.t && t <= b.t && a.v != null && b.v != null) return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
  }
  return null;
}

/** "rgb(12,34,56)" as its channels. */
const channels = (c: string): Rgb => {
  const m = c.match(/[\d.]+/g)?.map(Number) ?? [];
  return [m[0] ?? 128, m[1] ?? 128, m[2] ?? 128];
};
const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * The sun's light on the house at `ts`: where the sun really is from `at` (Brisbane until the place is set), turned
 * into the scene, whose street side faces the equator; how strong it is through `w`'s cloud; and the sky's own light
 * and its colour low down, from the sky as drawn (`sky`).
 */
export function lightAt(
  ts: number,
  at: { lat: number; lon: number } | null,
  w: SkyWeather,
  sky: Atmosphere["light"],
): Light {
  const { lat, lon } = at ?? { lat: -27.47, lon: 153.03 };
  const { el, az } = sunPlace(ts, lat, lon);
  const rad = Math.PI / 180;
  const flat = Math.cos(el * rad);
  const east = flat * Math.sin(az * rad);
  const north = flat * Math.cos(az * rad);
  const south = lat >= 0;
  const dir: P3 = [r2(south ? -east : east), r2(south ? -north : north), r2(Math.sin(el * rad))];
  const es = Math.sin(el * rad);
  return {
    dir,
    el: r2(el),
    L: r2(clamp01(es * 2.2) * (1 - 0.6 * w.cover)),
    warm: r2(clamp01(1 - el / 25)),
    cover: r2(w.cover),
    sky: r2(clamp01(sky.es * 3 + 0.25)),
    horizon: channels(sky.horizon).map(Math.round) as Rgb,
    es: r2(sky.es),
    rain: r2(sky.rain),
    moon: r2(sky.moon),
  };
}
