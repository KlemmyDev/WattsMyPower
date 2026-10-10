import { store, STORE_TIME_ZONE } from "~/features/common/storage/utils";

/**
 * Time helpers in unix seconds, in the site's time zone: the server's, which its days and daily totals are kept in
 * (sent with the live status). Not the browser's, which can be another state's, a trip away's, or UTC in a browser
 * that hides its zone for privacy. Days, hours and clock times are all worked out here (and drawn with
 * formatting/utils/date), never with a Date's own getHours(), setDate() and the like, which use the browser's zone.
 */

const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

const valid = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

// The zone last heard from the server, so the first draw is already in it; the browser's until then.
let zone = ((saved) => (saved && valid(saved) ? saved : browserZone()))(store.get(STORE_TIME_ZONE));
const offsets = new Map<number, number>();

/** The site's time zone, e.g. "Australia/Brisbane". */
export const siteZone = () => zone;

/** Use this zone from now on (from the live status). Pages already drawn need drawing again (see AppLayout). */
export function setSiteZone(tz: string | null | undefined) {
  if (!tz || tz === zone || !valid(tz)) return;
  zone = tz;
  offsets.clear();
  store.set(STORE_TIME_ZONE, tz);
}

let partsFmt: { zone: string; f: Intl.DateTimeFormat } | null = null;
const SLOT = 900; // zones change their offset on a quarter-hour of UTC, so it's looked up once per quarter-hour

/** The site zone's offset from UTC at `ts`, in seconds (36000 in Brisbane). */
export function offsetAt(ts: number): number {
  const slot = Math.floor(ts / SLOT);
  const known = offsets.get(slot);
  if (known !== undefined) return known;
  if (partsFmt?.zone !== zone) {
    const f = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
      timeZone: zone,
    });
    partsFmt = { zone, f };
  }
  const p: Record<string, number> = {};
  for (const { type, value } of partsFmt.f.formatToParts(slot * SLOT * 1000)) p[type] = Number(value);
  const off = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000 - slot * SLOT;
  if (offsets.size > 5000) offsets.clear();
  offsets.set(slot, off);
  return off;
}

/** A moment's date and time on the site's clock. `month` is 1 to 12; `weekday` is 0 for Sunday to 6 for Saturday. */
export type Parts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

/** Unix seconds (or a Date) as the date and time on the site's clock. */
export function partsOf(t: number | Date): Parts {
  const ts = typeof t === "number" ? t : t.getTime() / 1000;
  const d = new Date((ts + offsetAt(ts)) * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: d.getUTCDay(),
  };
}

/** The hour (0 to 23) on the site's clock. */
export const hourOf = (t: number | Date) => partsOf(t).hour;

/**
 * A date and time on the site's clock as unix seconds (`month` 1 to 12). Like `new Date(y, m, d)`, days and months
 * past the end roll over: day 0 is the last of the month before, month 13 is January next year.
 */
export function siteTime(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second) / 1000;
  const guess = wall - offsetAt(wall);
  return wall - offsetAt(guess);
}

export const nowS = () => Math.floor(Date.now() / 1000);

export function midnight(ts: number): number {
  const p = partsOf(ts);
  return siteTime(p.year, p.month, p.day);
}

export function addDays(ts: number, n: number): number {
  const p = partsOf(ts);
  return siteTime(p.year, p.month, p.day + n, p.hour, p.minute, p.second) + (ts % 1);
}

export const sameDay = (a: number, b: number) => midnight(a) === midnight(b);

/** Unix seconds as the site's "YYYY-MM-DD". */
export function dateKey(ts: number): string {
  const p = partsOf(ts);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** The site's "YYYY-MM-DD" (or "YYYY-MM", the 1st) as unix seconds at midnight. */
export function fromDateKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return siteTime(y, m, d || 1);
}

/** Monday 0 to Sunday 6. */
export const mondayFirst = (t: number | Date) => (partsOf(t).weekday + 6) % 7;

export const isWeekend = (t: number | Date) => [0, 6].includes(partsOf(t).weekday);

export function greeting(ts = nowS()): string {
  const h = hourOf(ts);
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
