import { addDays, dateKey, fromDateKey, midnight, nowS } from "~/features/common/time/utils";

export const METRIC_KEYS = ["gen", "ss", "imp", "saved"] as const;
export type Metric = (typeof METRIC_KEYS)[number];

/** The History page's URL state. Defaults are left out: this year, its last day with data, and Solar. */
export type HistorySearch = { year?: number; day?: string; metric?: Metric };

/** 1 January of `year`, local midnight in unix seconds. */
export const yearStart = (year: number) => new Date(year, 0, 1).getTime() / 1000;

export const yearOf = (ts: number) => new Date(ts * 1000).getFullYear();

/** The last day of `year` with data: today for the current year, 31 December for past years. */
export const lastDay = (year: number, today: number) => Math.min(today, addDays(yearStart(year + 1), -1));

const isMetric = (v: unknown): v is Metric => METRIC_KEYS.includes(v as Metric);

export function validateHistorySearch(raw: Record<string, unknown>): HistorySearch {
  const today = midnight(nowS());
  const thisYear = yearOf(today);
  const y = Number(raw.year);
  const year = Number.isInteger(y) && y >= 1970 && y < thisYear ? y : undefined;
  const shown = year ?? thisYear;
  let day: string | undefined;
  if (typeof raw.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.day)) {
    const ts = fromDateKey(raw.day);
    // A real date in the year shown, before its last day (later days, and the default, are dropped).
    if (dateKey(ts) === raw.day && yearOf(ts) === shown && ts < lastDay(shown, today)) day = raw.day;
  }
  return { year, day, metric: isMetric(raw.metric) && raw.metric !== "gen" ? raw.metric : undefined };
}

/** The year and day part of the search for showing the day starting at `ts`, defaults left out. */
export function daySearch(ts: number, today: number): Pick<HistorySearch, "year" | "day"> {
  const year = yearOf(ts);
  return {
    year: year === yearOf(today) ? undefined : year,
    day: ts === lastDay(year, today) ? undefined : dateKey(ts),
  };
}
