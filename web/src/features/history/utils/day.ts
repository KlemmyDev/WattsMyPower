import type { HistorySeries } from "~/features/common/readings/types";

/** A stretch of a day's energy (kWh): solar, home use, the grid (+ from it), the battery (+ discharging), and the
 * battery level at its end (%). */
export type Hour = {
  pv: number | null;
  load: number | null;
  grid: number | null;
  bat: number | null;
  soc: number | null;
};

/** Half an hour: the charts' bars are drawn this often. */
export const HALF_HOUR = 1800;

/**
 * A day's 5-minute readings as equal stretches of `seconds` from midnight (24 hours by default). Each stretch's energy
 * is its average power over the stretch.
 */
export function slotsOf(series: HistorySeries | undefined, dayTs: number, seconds = 3600): Hour[] {
  const n = Math.round(86400 / seconds);
  const acc = Array.from({ length: n }, () => ({
    pv: [0, 0],
    load: [0, 0],
    grid: [0, 0],
    bat: [0, 0],
    soc: null as number | null,
  }));
  series?.t.forEach((t, i) => {
    const k = Math.floor((t - dayTs) / seconds);
    if (k < 0 || k >= n) return;
    for (const [key, f] of [
      ["pv", "pv_power"],
      ["load", "load_power"],
      ["grid", "grid_power"],
      ["bat", "battery_power"],
    ] as const) {
      const v = series[f]?.[i];
      if (v != null) {
        acc[k][key][0] += v;
        acc[k][key][1]++;
      }
    }
    const soc = series.battery_soc?.[i];
    if (soc != null) acc[k].soc = soc;
  });
  const kwh = ([sum, c]: number[]) => (c ? (sum / c / 1000) * (seconds / 3600) : null);
  return acc.map((a) => ({ pv: kwh(a.pv), load: kwh(a.load), grid: kwh(a.grid), bat: kwh(a.bat), soc: a.soc }));
}

/** The day's highest solar reading (W) and when, and its lowest battery level (%). */
export function extremesOf(series: HistorySeries | undefined) {
  let peak: { w: number; t: number } | null = null;
  let low: number | null = null;
  series?.t.forEach((t, i) => {
    const pv = series.pv_power?.[i];
    const soc = series.battery_soc?.[i];
    if (pv != null && (!peak || pv > peak.w)) peak = { w: pv, t };
    if (soc != null && (low == null || soc < low)) low = soc;
  });
  return { peak: peak as { w: number; t: number } | null, low };
}
