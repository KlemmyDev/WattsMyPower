import type { HistorySeries } from "~/features/common/readings/types";

/** One hour of a day: energy in kWh (grid + from the grid, − to it), and the battery level at its end. */
/** An hour's energy (kWh): solar, home use, the grid (+ from it), the battery (+ discharging), and its level at the end (%). */
export type Hour = {
  pv: number | null;
  load: number | null;
  grid: number | null;
  bat: number | null;
  soc: number | null;
};

/** A day's 5-minute readings as 24 hours. Each hour's energy is its average power over the hour. */
export function hoursOf(series: HistorySeries | undefined, dayTs: number): Hour[] {
  const acc = Array.from({ length: 24 }, () => ({
    pv: [0, 0],
    load: [0, 0],
    grid: [0, 0],
    bat: [0, 0],
    soc: null as number | null,
  }));
  series?.t.forEach((t, i) => {
    const h = Math.floor((t - dayTs) / 3600);
    if (h < 0 || h > 23) return;
    for (const [k, f] of [
      ["pv", "pv_power"],
      ["load", "load_power"],
      ["grid", "grid_power"],
      ["bat", "battery_power"],
    ] as const) {
      const v = series[f]?.[i];
      if (v != null) {
        acc[h][k][0] += v;
        acc[h][k][1]++;
      }
    }
    const soc = series.battery_soc?.[i];
    if (soc != null) acc[h].soc = soc;
  });
  const kwh = ([sum, n]: number[]) => (n ? sum / n / 1000 : null);
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
