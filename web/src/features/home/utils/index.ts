import { hhmm, hourLabel } from "~/features/common/formatting/utils/date";
import { kW, kWh } from "~/features/common/formatting/utils/number";
import { COLOR, DEVICE_COLORS } from "~/features/common/theme/utils/colors";
import type { IconName } from "~/features/common/ui/components/Icon";
import type { DeviceKind, DevicePattern, HomeDevice, HomeIntegration, HomeUsage } from "~/features/home/types";

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
/** The car's charging, in the breakdown: its own colour, and an id no device has. */
export const CAR_COLOR = COLOR.lilac;
export const CAR_ID = -1;

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

/**
 * What the Home page shows, in the devices' order: each visible device on its own, and each group (the plugs in a
 * room) as one, at its first visible member's place (or, not `byRoom`, every device on its own). A group stands in for its members by its first visible member's
 * id (so it keeps that member's colour); its hidden members are left out, as they are of the breakdown.
 */
export type HomeItem = { id: number; group: string | null; members: HomeDevice[] };

export function homeItems(devices: HomeDevice[], byRoom = true): HomeItem[] {
  const items: HomeItem[] = [];
  const groups = new Map<string, HomeItem>();
  for (const device of devices) {
    if (device.hidden) continue;
    const d = byRoom ? device : { ...device, group: null }; // by device: each on its own, its group aside
    const item = d.group ? groups.get(d.group) : undefined;
    if (item) item.members.push(d);
    else {
      const added = { id: d.id, group: d.group, members: [d] };
      items.push(added);
      if (d.group) groups.set(d.group, added);
    }
  }
  return items;
}

type Used = HomeUsage["devices"][number];

const weighted = (parts: Used[], value: (u: Used) => number | null) => {
  const counted = parts.filter((u) => u.runs && value(u) != null);
  const runs = counted.reduce((a, u) => a + u.runs, 0);
  return runs ? counted.reduce((a, u) => a + value(u)! * u.runs, 0) / runs : null;
};

/** The share of parts' energy that came from the panels or the battery, together. */
const solarShare = (parts: Used[]) => {
  const total = parts.reduce((a, u) => a + u.total, 0);
  return total > 0 ? parts.reduce((a, u) => a + (u.solar_share ?? 0) * u.total, 0) / total : null;
};

/** The breakdown with each group's members added up into one, standing in by the group's id and named for it. */
export function groupUsage(usage: HomeUsage, items: HomeItem[]): HomeUsage {
  const byId = new Map(usage.devices.map((u) => [u.id, u]));
  const devices = items.flatMap((item): Used[] => {
    const parts = item.members.map((m) => byId.get(m.id)).filter((u) => u != null);
    if (!item.group) return parts;
    if (!parts.length) return [];
    return [
      {
        id: item.id,
        name: item.group,
        kind: parts[0].kind,
        kwh: usage.t.map((_, i) => parts.reduce((a, u) => a + u.kwh[i], 0)),
        total: parts.reduce((a, u) => a + u.total, 0),
        runs: parts.reduce((a, u) => a + u.runs, 0),
        run_kwh: weighted(parts, (u) => u.run_kwh),
        run_minutes: weighted(parts, (u) => u.run_minutes),
        cost: parts.reduce((a, u) => a + u.cost, 0),
        solar_share: solarShare(parts),
      },
    ];
  });
  return { ...usage, devices };
}

const sumOrNull = (values: (number | null)[]) =>
  values.some((v) => v != null) ? values.reduce<number>((a, v) => a + (v ?? 0), 0) : null;

/**
 * A group's habits: its members' added up (what each uses on an average day, together), judged over the longest any
 * of them has been read.
 */
export function groupPattern(patterns: DevicePattern[], item: HomeItem): DevicePattern | undefined {
  const parts = item.members.map((m) => patterns.find((p) => p.id === m.id)).filter((p) => p != null);
  if (parts.length < 2) return parts[0] && { ...parts[0], id: item.id };
  const col = <K extends keyof DevicePattern>(key: K) => parts.map((p) => p[key] as (number | null)[]);
  const zip = (cols: (number | null)[][], f: (vs: (number | null)[]) => number | null) =>
    cols[0].map((_, i) => f(cols.map((c) => c[i])));
  const runs = parts.reduce((a, p) => a + p.runs, 0);
  const avg = (key: "run_kwh" | "run_minutes") =>
    runs ? parts.reduce((a, p) => a + (p[key] ?? 0) * p.runs, 0) / runs : null;
  return {
    id: item.id,
    days: Math.max(...parts.map((p) => p.days)),
    daily_kwh: sumOrNull(parts.map((p) => p.daily_kwh)),
    by_weekday: zip(col("by_weekday"), sumOrNull),
    by_hour: zip(col("by_hour"), sumOrNull),
    weekdays_seen: zip(col("weekdays_seen"), (vs) => Math.max(...vs.map((v) => v ?? 0))) as number[],
    runs,
    run_days: zip(col("run_days"), (vs) => vs.reduce<number>((a, v) => a + (v ?? 0), 0)) as number[],
    run_hours: zip(col("run_hours"), (vs) => vs.reduce<number>((a, v) => a + (v ?? 0), 0)) as number[],
    run_kwh: avg("run_kwh"),
    run_minutes: avg("run_minutes"),
  };
}

/** The groups devices are in, by name, with how many are in each. */
export function groupNames(devices: HomeDevice[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of devices) if (d.group) out.set(d.group, (out.get(d.group) ?? 0) + 1);
  return out;
}

/** The group a device's name suggests: "Study" for "Study (Left)" or "Study - Right". */
export function suggestedGroup(name: string): string | null {
  const m = /^(.+?)(?:\s*\(.+\)|\s+[-–]\s+.+)$/.exec(name.trim());
  return m ? m[1].trim() : null;
}
