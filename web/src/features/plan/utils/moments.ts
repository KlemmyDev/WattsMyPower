import type { ForecastHour } from "~/features/common/weather/types";
import { hhmm } from "~/features/common/formatting/utils/date";
import { COLOR } from "~/features/common/theme/utils/colors";
import { isWet } from "~/features/common/weather/utils";
import { hourEnd } from "~/features/plan/utils";

/** Something worth knowing is coming: the battery filling, solar falling behind home use, rain. */
export type Moment = {
  t: number;
  title: string;
  sub: string;
  color: string;
  /** Numbered in time order, from 1. */
  num: number;
};

/**
 * The key moments in a stretch of forecast hours (`hrs`, up to `end`), numbered in time order: when the
 * battery fills (`fullAt`, from the forecast or, earlier today, the readings), when solar drops below home use
 * in the afternoon, when the battery runs down to its reserve, and the first daytime rain (the only rain that
 * matters for solar). A fill before `now` is told in the past tense.
 */
export function moments(
  hrs: ForecastHour[],
  { now, end, fullAt, reserve }: { now: number; end: number; fullAt: number | null; reserve: number },
): Moment[] {
  if (!hrs.length) return [];
  const out: Omit<Moment, "num">[] = [];
  if (fullAt != null && fullAt < end)
    out.push(
      fullAt <= now
        ? { t: fullAt, title: "Battery filled", sub: "Extra solar has gone to the grid since", color: COLOR.battery }
        : { t: fullAt, title: "Battery full", sub: "Extra solar goes to the grid", color: COLOR.battery },
    );

  const drop = hrs.find((h, k) => k > 0 && h.is_day && new Date(h.ts * 1000).getHours() >= 13 && h.pv_kw < h.load_kw);
  if (drop)
    out.push({
      t: drop.ts,
      title: "Solar drops below home use",
      sub: "Battery starts powering your home",
      color: COLOR.solar,
    });

  // The first time it comes down to the reserve (not hours it's already sitting there), after any fill.
  const low = (h: ForecastHour) => h.soc <= reserve + 0.5;
  const res = hrs.find((h, k) => low(h) && (k === 0 || !low(hrs[k - 1])) && (fullAt == null || h.start > fullAt));
  if (res) {
    const t = Math.min(end, hourEnd(res));
    const morning = new Date(t * 1000).getHours() < 12;
    out.push({
      t,
      title: "Battery reaches reserve",
      sub: morning ? "Your home runs on the grid until solar picks up" : "Your home runs on the grid until morning",
      color: COLOR.gridSoft,
    });
  }

  const wet = (h: ForecastHour) => isWet(h.code) || h.precip >= 50;
  const k0 = hrs.findIndex((h) => wet(h) && h.is_day);
  if (k0 >= 0) {
    const k1 = hrs.findIndex((h, k) => k > k0 && !wet(h));
    const until = k1 < 0 ? hourEnd(hrs[hrs.length - 1]) : hrs[k1].ts;
    out.push({
      t: hrs[k0].start,
      title: `Showers until ${hhmm(until)}`,
      sub:
        new Date(hrs[k0].start * 1000).getHours() < 12 ? "Lower solar early in the day" : "Lower solar while it rains",
      color: COLOR.link,
    });
  }

  return out.sort((a, b) => a.t - b.t).map((m, i) => ({ ...m, num: i + 1 }));
}
