import { energyToday, ON } from "~/features/common/energy/utils";
import type { Snapshot } from "~/features/common/live/types";
import type { HistorySeries } from "~/features/common/readings/types";
import { COLOR } from "~/features/common/theme/utils/colors";
import { dateKey, hourOf, midnight } from "~/features/common/time/utils";
import type { Forecast } from "~/features/common/weather/types";
import type { HomeDevice, HomeUsage, RoomLook } from "~/features/home/types";
import { CAR_COLOR, deviceColors, groupUsage, homeItems, OTHER_COLOR } from "~/features/home/utils";

/** The house's colour, and what a usual day is drawn in beside it. */
export const HOME = COLOR.teal;
/** Where the house's power comes from, as History has it. */
export const SOURCES = { solar: COLOR.solar, battery: COLOR.battery, grid: COLOR.bar } as const;
export type Source = keyof typeof SOURCES;

/** What the house usually uses by `t` today (kWh), from the forecast's typical day (kW by the hour). */
export function usualBy(profile: number[] | undefined, t: number): number | null {
  if (profile?.length !== 24) return null;
  const start = midnight(t);
  let kwh = 0;
  for (let h = 0; h < 24; h++) {
    const from = start + h * 3600;
    if (from >= t) break;
    kwh += (profile[h] * (Math.min(t, from + 3600) - from)) / 3600;
  }
  return kwh;
}

/** Each 5 minutes' home use split by where it came from: solar first, then the battery, then the grid (kWh). */
export function sourcesOf(series: HistorySeries | undefined) {
  const out = { solar: 0, battery: 0, grid: 0 };
  if (!series) return out;
  const t = series.t;
  for (let i = 0; i < t.length; i++) {
    const load = series.load_power?.[i];
    if (load == null || load <= 0) continue;
    const step = ((t[i + 1] ?? t[i] + 300) - t[i]) / 3600;
    const solar = Math.min(load, Math.max(0, series.pv_power?.[i] ?? 0));
    const battery = Math.min(load - solar, Math.max(0, series.battery_power?.[i] ?? 0));
    out.solar += (solar / 1000) * step;
    out.battery += (battery / 1000) * step;
    out.grid += (Math.max(0, load - solar - battery) / 1000) * step;
  }
  return out;
}

/**
 * The house now: what it's drawing, split by where it's coming from (solar first, then the battery, then the grid), and
 * against what it usually draws at this hour (from the forecast's typical day).
 */
export function homeNow(p: Snapshot | null, f: Forecast | null | undefined, now: number) {
  const load = p?.load_power == null ? null : Math.max(0, p.load_power);
  const L = load ?? 0;
  const solar = Math.min(L, Math.max(0, p?.pv_power ?? 0));
  const battery = Math.min(L - solar, Math.max(0, p?.battery_power ?? 0));
  const grid = Math.max(0, L - solar - battery);
  const profile = f?.load_basis?.profile_kw;
  const usual = profile?.length === 24 ? profile[hourOf(now)] * 1000 : null;
  return {
    load,
    from: [
      { key: "solar" as Source, label: "Solar", w: solar },
      { key: "battery" as Source, label: "Battery", w: battery },
      { key: "grid" as Source, label: "Grid", w: grid },
    ],
    /** What it usually draws at this hour (W). */
    usual,
    /** Now against that: +0.18 is 18% more. Left out while it usually draws next to nothing. */
    vsUsual: load != null && usual != null && usual > 100 ? load / usual - 1 : null,
    drawing: load != null && load > ON,
  };
}

/**
 * The house today: what it's used (the inverter's counters), what it usually has by now and in a whole day, where it's
 * heading by midnight at a usual pace, the pace against usual, the day's peak, and how much it made itself.
 */
export function homeToday({
  p,
  f,
  series,
  now,
}: {
  p: Snapshot | null;
  f: Forecast | null | undefined;
  series: HistorySeries | undefined;
  now: number;
}) {
  const used = energyToday(p)?.home ?? null;
  const profile = f?.load_basis?.profile_kw;
  const usualNow = usualBy(profile, now);
  const usualDay = profile?.length === 24 ? profile.reduce((a, kw) => a + kw, 0) : null;
  const rest = f?.days.find((d) => d.date === dateKey(now))?.load_kwh ?? null;
  const heading = used != null && rest != null ? used + rest : null;
  let peak: { t: number; w: number } | null = null;
  const t = series?.t ?? [];
  const v = series?.load_power ?? [];
  for (let i = 0; i < t.length; i++) {
    const w = v[i];
    if (w != null && w > ON && (!peak || w > peak.w)) peak = { t: t[i], w };
  }
  const s = sourcesOf(series);
  const sum = s.solar + s.battery + s.grid;
  return {
    used,
    usualNow,
    usualDay,
    heading,
    /** Today against a usual day by now: +0.13 is 13% more. */
    pace: used != null && usualNow != null && usualNow > 0.2 ? used / usualNow - 1 : null,
    peak,
    /** The share of today's use the house made itself (solar and the battery), from the readings. */
    self: sum > 0.05 ? 1 - s.grid / sum : null,
  };
}

/** A lane of today: one room, device, the car or everything else, its use each hour (starting at `t`) and its colour. */
export type Lane = { key: string; label: string; color: string; t: number[]; kwh: (number | null)[]; total: number };

/**
 * Today hour by hour, a lane each for what used anything: each room (or device on its own), the car, then everything
 * no device measured; the most first, everything else last. At most `max` rooms and devices, the rest folded into
 * everything else.
 */
export function todayLanes(
  usage: HomeUsage | undefined,
  devices: HomeDevice[],
  rooms: RoomLook[] | undefined,
  max = 7,
): Lane[] {
  if (!usage) return [];
  const items = homeItems(devices);
  const grouped = groupUsage(usage, items);
  const colors = deviceColors(devices, rooms, { byRoom: true });
  const parts = grouped.devices
    .filter((u) => u.total >= 0.01)
    .sort((a, b) => b.total - a.total)
    .map((u) => ({
      key: String(u.id),
      label: u.name,
      color: colors.get(u.id) ?? OTHER_COLOR,
      t: usage.t,
      kwh: u.kwh,
      total: u.total,
    }));
  const kept = parts.slice(0, max);
  const folded = parts.slice(max);
  const other = usage.other.map((v, i) => (v == null ? null : v + folded.reduce((a, p) => a + (p.kwh[i] ?? 0), 0)));
  const otherTotal = other.reduce<number>((a, v) => a + (v ?? 0), 0);
  return [
    ...kept,
    ...(usage.car && usage.car.total >= 0.01
      ? [{ key: "car", label: "Car", color: CAR_COLOR, t: usage.t, kwh: usage.car.kwh, total: usage.car.total }]
      : []),
    ...(otherTotal >= 0.01
      ? [{ key: "other", label: "Everything else", color: OTHER_COLOR, t: usage.t, kwh: other, total: otherTotal }]
      : []),
  ];
}
