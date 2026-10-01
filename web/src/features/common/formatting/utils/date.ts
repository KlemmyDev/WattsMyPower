/** Date, time and duration formatting (en-AU, 24-hour). */

type Fmt = { format: (d: Date) => string };
// The design uses three-letter months and no commas; en-AU writes "Sept" and adds commas.
const tidy = (opts: Intl.DateTimeFormatOptions): Fmt => {
  const f = new Intl.DateTimeFormat("en-AU", opts);
  return {
    format: (d) =>
      f
        .format(d)
        .replace(/\bSept\b/, "Sep")
        .replace(/,/g, ""),
  };
};

const timeFmt = new Intl.DateTimeFormat("en-AU", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** Unix seconds as "14:05". */
export const hhmm = (ts: number) => timeFmt.format(new Date(ts * 1000));
/** An hour of the day as "07:00". */
export const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;
/** Minutes after midnight as "07:30". */
export const minutesLabel = (m: number) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export const fullDate = tidy({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
export const pillDate = tidy({ weekday: "short", day: "numeric", month: "short" });
export const shortDay = tidy({ weekday: "short", day: "numeric", month: "short" });
export const longDate = tidy({ day: "numeric", month: "long", year: "numeric" });
export const monthShort = tidy({ month: "short" });
export const monthYear = tidy({ month: "short", year: "numeric" });
export const monthLong = new Intl.DateTimeFormat("en-AU", { month: "long" });
export const monthYearLong = new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric" });
export const weekdayLong = new Intl.DateTimeFormat("en-AU", { weekday: "long" });

/** Unix seconds as "2 Oct". */
export const dayMonth = (ts: number) => {
  const d = new Date(ts * 1000);
  return `${d.getDate()} ${monthShort.format(d)}`;
};

/** The local time zone's short name, e.g. "AEST". */
export const tzName = (() => {
  try {
    return (
      new Intl.DateTimeFormat("en-AU", { timeZoneName: "short" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
})();

/** "2026-10-01" (or "2026-10") as a local Date. */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d || 1);
}

/** A duration in seconds as "2 h 5 min" or "45 min". */
export function duration(secs: number): string {
  const m = Math.max(0, Math.round(secs / 60));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h} h ${r} min` : `${r} min`;
}

/** "8, 17, and 24 September" / "30 August and 2 September" from YYYY-MM-DD strings. */
export function listDays(dates: string[]): string {
  const groups: { m: string; days: number[] }[] = [];
  for (const d of dates.map(parseYmd)) {
    const g = groups[groups.length - 1];
    const m = monthLong.format(d);
    if (g && g.m === m) g.days.push(d.getDate());
    else groups.push({ m, days: [d.getDate()] });
  }
  const join = (xs: (string | number)[]) =>
    xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`;
  return join(groups.map((g) => `${join(g.days)} ${g.m}`));
}
