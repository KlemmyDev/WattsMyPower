import type { LiveStatus, Snapshot, SystemInfo } from "~/features/common/live/types";

/** Below this many watts a flow counts as idle. */
export const ON = 50;

export type BatteryState = "charge" | "discharge" | "idle";
/** Battery power is + when discharging and − when charging. */
export const batteryState = (w: number | null | undefined): BatteryState | null =>
  w == null ? null : w < -ON ? "charge" : w > ON ? "discharge" : "idle";

export const gridVerb = (g: number | null | undefined) =>
  g == null ? "Grid" : g > ON ? "Importing" : g < -ON ? "Exporting" : "Grid idle";

export const DEFAULT_RESERVE = 10;
export const reserveOf = (s: SystemInfo | undefined) => s?.battery_reserve ?? DEFAULT_RESERVE;

/** True when the last reading is recent (within three poll intervals). */
export function isFresh(st: LiveStatus | undefined, now: number): boolean {
  return !!(st && st.last_success && now - st.last_success < (st.poll_interval || 60) * 3);
}

/** The forecast location's place name, or its coordinates until one has been looked up. */
export function locationLabel(s: SystemInfo | undefined): string {
  if (!s) return "your location";
  if (s.location_name) return s.location_name;
  return s.latitude != null ? `${Number(s.latitude).toFixed(2)}, ${Number(s.longitude).toFixed(2)}` : "your location";
}

/** Home use today from the inverter's daily counters. */
export function energyToday(p: Snapshot | null | undefined) {
  if (!p || p.daily_pv == null || p.daily_import == null || p.daily_export == null) return null;
  const chg = p.daily_charge || 0;
  const dis = p.daily_discharge || 0;
  const { daily_pv: pv, daily_import: imp, daily_export: exp } = p;
  return { pv, imp, exp, chg, dis, home: Math.max(0, pv + imp - exp + dis - chg) };
}
