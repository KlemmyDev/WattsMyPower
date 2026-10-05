import { hhmm, hourLabel } from "~/features/common/formatting/utils/date";
import { kW, kWh } from "~/features/common/formatting/utils/number";
import { COLOR, DEVICE_COLORS } from "~/features/common/theme/utils/colors";
import type { IconName } from "~/features/common/ui/components/Icon";
import type { DeviceKind, DevicePattern, HomeDevice, HomeIntegration } from "~/features/home/types";

const KIND_ICONS: Record<DeviceKind, IconName> = {
  washer: "washer",
  dryer: "dryer",
  washer_dryer: "washer",
  dishwasher: "dishwasher",
  oven: "flame",
  fridge: "fridge",
  freezer: "fridge",
  air_conditioner: "snowflake",
  hot_water: "droplet",
  pool_pump: "droplet",
  plug: "plug",
};

export const kindIcon = (kind: DeviceKind): IconName => KIND_ICONS[kind] ?? "bolt";

/** An integration's icon, if the web app has it. */
export const integrationIcon = (i: Pick<HomeIntegration, "icon">): IconName =>
  (["washer", "flask", "plug", "bolt", "fridge"] as const).find((n) => n === i.icon) ?? "plug";

/**
 * Each device's colour: by its place among every device (hidden ones included), so hiding or adding one never
 * repaints the rest. Past the palette, devices share a quiet grey; "everything else" is the bar grey.
 */
export function deviceColors(devices: Pick<HomeDevice, "id">[]): Map<number, string> {
  return new Map(devices.map((d, i) => [d.id, DEVICE_COLORS[i] ?? COLOR.gridSoft]));
}
export const OTHER_COLOR = COLOR.bar;

/** What a device is doing now, in a few words. */
export function nowLine(d: HomeDevice): { text: string; running: boolean } {
  const n = d.now;
  if (!n) return { text: "Waiting for its first reading", running: false };
  if (n.stale) return { text: `Not read since ${hhmm(n.at)}`, running: false };
  if (!n.online) return { text: "Offline", running: false };
  if (n.running) {
    const left = n.remaining_min ? `${Math.round(n.remaining_min)} min left` : null;
    return { text: [n.phase ?? "Running", left].filter(Boolean).join(" · "), running: true };
  }
  if (n.power_w != null && n.power_w >= 2) return { text: `Using ${kW(n.power_w)}`, running: false };
  return { text: "Idle", running: false };
}

const WEEKDAYS = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Wednesdays and weekends", "weekdays", "Mondays, Thursdays and Saturdays" from Monday-first flags. */
export function dayList(on: boolean[]): string {
  const parts: string[] = [];
  const weekdays = on.slice(0, 5).every(Boolean);
  const weekend = on[5] && on[6];
  if (weekdays) parts.push("weekdays");
  else on.slice(0, 5).forEach((x, i) => x && parts.push(WEEKDAYS[i]));
  if (weekend) parts.push("weekends");
  else on.slice(5).forEach((x, i) => x && parts.push(WEEKDAYS[5 + i]));
  if (weekdays && weekend) return "every day";
  return parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const PARTS_OF_DAY: [label: string, from: number, to: number][] = [
  ["mornings", 5, 12],
  ["afternoons", 12, 17],
  ["evenings", 17, 22],
  ["overnight", 22, 29],
];

/** When in the day most runs start: "mornings", "mornings and evenings". */
function partsOfDay(hours: number[]): string {
  const total = hours.reduce((a, b) => a + b, 0);
  if (!total) return "";
  const share = PARTS_OF_DAY.map(([label, from, to]) => {
    let n = 0;
    for (let h = from; h < to; h++) n += hours[h % 24];
    return { label, n: n / total };
  });
  const main = share.filter((s) => s.n >= 0.3).sort((a, b) => b.n - a.n);
  return main.map((s) => s.label).join(" and ");
}

/**
 * A device's habits in a line. For an appliance that runs in cycles: which days it usually runs (a day it ran on in
 * at least half the weeks), when, and how often; otherwise, when in the day it uses most, and what it uses a day.
 */
export function habitLine(p: DevicePattern | undefined, cycles: boolean): string | null {
  if (!p || p.days < 7) return p && p.days > 0 ? "Its habits show after a week of readings" : null;
  const weeks = p.days / 7;
  if (cycles) {
    if (!p.runs) return "No runs in the last " + (p.days >= 56 ? "eight weeks" : `${Math.round(weeks)} weeks`);
    const usual = p.run_days.map((n, i) => p.weekdays_seen[i] > 0 && n / p.weekdays_seen[i] >= 0.5);
    const days = dayList(usual);
    const when = partsOfDay(p.run_hours);
    const often = p.runs / weeks;
    const rate =
      often >= 0.75 ? `about ${Math.round(often)} a week` : `about ${Math.max(1, Math.round(often * 4))} a month`;
    const head = days ? `Usually ${days}${when ? `, ${when}` : ""}` : `No set day${when ? `; mostly ${when}` : ""}`;
    return `${head} · ${rate}`;
  }
  const hours = p.by_hour.map((v) => v ?? 0);
  const peak = Math.max(...hours);
  const mean = hours.reduce((a, b) => a + b, 0) / 24;
  const daily = p.daily_kwh != null ? `${kWh(p.daily_kwh)} a day` : null;
  if (!peak) return daily;
  if (peak < mean * 1.8) return ["Steady through the day", daily].filter(Boolean).join(" · ");
  // The longest stretch of hours using at least half the peak.
  let best = [0, 0];
  for (let h = 0, start = -1; h <= 24; h++) {
    const on = h < 24 && hours[h] >= peak / 2;
    if (on && start < 0) start = h;
    if (!on && start >= 0) {
      if (h - start > best[1] - best[0]) best = [start, h];
      start = -1;
    }
  }
  return [`Mostly ${hourLabel(best[0])}–${hourLabel(best[1] % 24)}`, daily].filter(Boolean).join(" · ");
}
