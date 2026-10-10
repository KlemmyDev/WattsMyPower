import { addDays, dateKey, fromDateKey, midnight, nowS, partsOf, siteTime } from "~/features/common/time/utils";

export const METRIC_KEYS = ["gen", "ss", "imp", "saved", "weather"] as const;
export type Metric = (typeof METRIC_KEYS)[number];

/**
 * The History page's URL state. Defaults are left out: this year, its last day so far, and Solar.
 * `year` shows an earlier calendar year instead.
 */
export type HistorySearch = { year?: number; day?: string; metric?: Metric };

/**
 * The days a view covers, [start, end) in local-midnight unix seconds: always 1 January to 31 December,
 * so the heatmap runs January to December. `last` is its last day that has happened (today, this year).
 */
export type Range = { start: number; end: number; last: number };

/** 1 January of `year`, midnight on the site's clock in unix seconds. */
export const yearStart = (year: number) => siteTime(year, 1, 1);

export const yearOf = (ts: number) => partsOf(ts).year;

/** A calendar year: this one when `year` is left out. */
export function rangeOf(year: number | undefined, today: number): Range {
  const y = year ?? yearOf(today);
  const end = yearStart(y + 1);
  return { start: yearStart(y), end, last: Math.min(addDays(end, -1), today) };
}

/** The last day of a view that has happened, which it opens on. */
export const lastDay = (r: Range) => r.last;

const isMetric = (v: unknown): v is Metric => METRIC_KEYS.includes(v as Metric);

export function validateHistorySearch(raw: Record<string, unknown>): HistorySearch {
  const today = midnight(nowS());
  // A day on its own (a link from Bills, say) opens its own year.
  const linked = typeof raw.day === "string" ? Number(raw.day.slice(0, 4)) : NaN;
  const y = raw.year === undefined ? linked : Number(raw.year);
  // This year is the default, so it's left out.
  const year = Number.isInteger(y) && y >= 1970 && y < yearOf(today) ? y : undefined;
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
