import type { Outlook } from "~/features/battery/types";
import { ON } from "~/features/common/energy/utils";
import type { Snapshot } from "~/features/common/live/types";
import type { HistorySeries } from "~/features/common/readings/types";

/**
 * Where today's charge came from and where the discharge went, from the 5-minute readings: while charging, solar goes
 * to the house first and the grid makes up the rest; while discharging, the house comes first and the rest is
 * exported. The totals are the inverter's daily counters when it has them, with the split scaled to them.
 */
export function inOutToday(series: HistorySeries | undefined, p: Snapshot | null) {
  const f = { solar: 0, grid: 0, home: 0, out: 0 };
  if (series) {
    const t = series.t;
    for (let i = 0; i < t.length; i++) {
      const bat = series.battery_power?.[i];
      if (bat == null) continue;
      const step = ((t[i + 1] ?? t[i] + 300) - t[i]) / 3600;
      const pv = Math.max(0, series.pv_power?.[i] ?? 0);
      const load = Math.max(0, series.load_power?.[i] ?? 0);
      const grid = series.grid_power?.[i] ?? 0;
      if (bat < -ON) {
        const charge = -bat / 1000;
        const fromGrid = Math.max(0, Math.min(charge, (Math.max(0, grid) - Math.max(0, load - pv)) / 1000));
        f.grid += fromGrid * step;
        f.solar += (charge - fromGrid) * step;
      } else if (bat > ON) {
        const dis = bat / 1000;
        const toGrid = Math.max(0, Math.min(dis, (Math.max(0, -grid) - Math.max(0, pv - load)) / 1000));
        f.out += toGrid * step;
        f.home += (dis - toGrid) * step;
      }
    }
  }
  const charged = p?.daily_charge ?? f.solar + f.grid;
  const discharged = p?.daily_discharge ?? f.home + f.out;
  const scale = (a: number, b: number, to: number) => (a + b > 0 ? [(a / (a + b)) * to, (b / (a + b)) * to] : [0, 0]);
  const [solar, grid] = scale(f.solar, f.grid, charged);
  const [home, out] = scale(f.home, f.out, discharged);
  return { charged, discharged, solar, grid, home, out };
}

/** The level a line has at `t`, between its points; null outside it. */
export function levelOn(line: [number, number][], t: number): number | null {
  if (!line.length || t < line[0][0] || t > line[line.length - 1][0]) return null;
  for (let i = 1; i < line.length; i++) {
    const [t0, v0] = line[i - 1];
    const [t1, v1] = line[i];
    if (t <= t1) return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  return line[line.length - 1][1];
}

/** The lowest level expected over the next `hours` as things are set, and when; null when it won't go below now. */
export function lowestAhead(outlook: Outlook | null | undefined, soc: number | null, now: number, hours = 24) {
  const pts = (outlook?.points ?? []).filter(([t]) => t > now && t <= now + hours * 3600);
  if (!pts.length || soc == null) return null;
  const [t, v] = pts.reduce((a, x) => (x[1] < a[1] ? x : a));
  return v < soc - 1 ? { t, soc: v } : null;
}

/** When the battery's expected to be full again (within its max), as things are set; null if not by tomorrow's end. */
export function fullAgain(outlook: Outlook | null | undefined, now: number, top: number) {
  const hit = (outlook?.points ?? []).find(([t, v]) => t > now && v >= top - 1);
  return hit ? hit[0] : null;
}
