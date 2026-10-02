import { addDays, dateKey, fromDateKey, midnight, nowS } from "~/features/common/time/utils";

export const METRIC_KEYS = ["gen", "ss", "imp", "saved"] as const;
export type Metric = (typeof METRIC_KEYS)[number];

/**
 * The History page's URL state. Defaults are left out: the last 12 months, its last day, and Solar.
 * `year` shows that calendar year instead.
 */
export type HistorySearch = { year?: number; day?: string; metric?: Metric };

/** The days a view covers, [start, end) in local-midnight unix seconds. */
export type Range = { start: number; end: number };

/** 1 January of `year`, local midnight in unix seconds. */
export const yearStart = (year: number) => new Date(year, 0, 1).getTime() / 1000;

export const yearOf = (ts: number) => new Date(ts * 1000).getFullYear();

/** The last 12 months up to today, or a calendar year (up to today, for this one). */
export function rangeOf(year: number | undefined, today: number): Range {
  if (year === undefined) {
    const d = new Date(today * 1000);
    return {
      start: new Date(d.getFullYear() - 1, d.getMonth(), d.getDate() + 1).getTime() / 1000,
      end: addDays(today, 1),
    };
  }
  return { start: yearStart(year), end: Math.min(yearStart(year + 1), addDays(today, 1)) };
}

/** The last day a view covers, which it opens on. */
export const lastDay = (r: Range) => addDays(r.end, -1);

const isMetric = (v: unknown): v is Metric => METRIC_KEYS.includes(v as Metric);

export function validateHistorySearch(raw: Record<string, unknown>): HistorySearch {
  const today = midnight(nowS());
  const y = Number(raw.year);
  const year = Number.isInteger(y) && y >= 1970 && y <= yearOf(today) ? y : undefined;
  const range = rangeOf(year, today);
  let day: string | undefined;
  if (typeof raw.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.day)) {
    const ts = fromDateKey(raw.day);
    // A real date in the view, before its last day (later days, and the default, are dropped).
    if (dateKey(ts) === raw.day && ts >= range.start && ts < lastDay(range)) day = raw.day;
  }
  return { year, day, metric: isMetric(raw.metric) && raw.metric !== "gen" ? raw.metric : undefined };
}

/** The day part of the search for showing the day starting at `ts` in a view, the default left out. */
export const daySearch = (ts: number, r: Range): Pick<HistorySearch, "day"> => ({
  day: ts === lastDay(r) ? undefined : dateKey(ts),
});
