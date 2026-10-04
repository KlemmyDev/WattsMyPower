import type { CarView, SuggestedCharge } from "~/features/car/types";
import { hhmm, weekdayLong } from "~/features/common/formatting/utils/date";
import { kWh, money, pct } from "~/features/common/formatting/utils/number";
import { addDays, midnight } from "~/features/common/time/utils";

/** "Tonight 22:00", "Tomorrow 06:30", "Monday 18:00": when a charge starts, in words. */
export function when(ts: number, now: number): string {
  const day = midnight(ts);
  const today = midnight(now);
  const name =
    day === today
      ? new Date(ts * 1000).getHours() >= 18
        ? "Tonight"
        : "Today"
      : day === addDays(today, 1)
        ? "Tomorrow"
        : weekdayLong.format(ts * 1000);
  return `${name} ${hhmm(ts)}`;
}

export const phaseWord = (n: number) => (n === 3 ? "three-phase" : n === 1 ? "single phase" : `${n}-phase`);

/** A local "YYYY-MM-DDTHH:mm" for a datetime-local input, and back. */
export const toLocal = (ts: number) => {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const fromLocal = (v: string) => Math.floor(new Date(v).getTime() / 1000);

/** Minutes after midnight as "07:30", for a time input, and back. */
export const minutesToTime = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
export const timeToMinutes = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** The next time of day `minutes` after midnight that's at least an hour away (as the server picks it). */
export function nextReadyBy(now: number, minutes: number, skip = 0): number {
  for (let d = 0; d < 4; d++) {
    const t = addDays(midnight(now), d) + minutes * 60;
    if (t - now >= 3600 && skip-- <= 0) return t;
  }
  return addDays(midnight(now), 1) + minutes * 60;
}

/** One line for a charge: its power, the car's charge at each end, and the energy from the wall. */
export function chargeLine(c: {
  amps: number;
  phases: number;
  power_kw: number;
  soc_from: number | null;
  soc_to: number | null;
  wall_kwh: number;
}) {
  const levels = c.soc_from != null && c.soc_to != null ? ` · ${pct(c.soc_from)} → ${pct(c.soc_to)}` : "";
  return `${c.amps} A ${phaseWord(c.phases)} (${c.power_kw.toFixed(1)} kW)${levels} · about ${kWh(c.wall_kwh)} from the wall`;
}

/** What a suggested charge adds to the bill, in words: "about $1.20", "nothing", or what it earns. */
export const costWords = (cost: number) =>
  Math.abs(cost) < 0.05 ? "next to nothing" : cost < 0 ? `earns about ${money(-cost)}` : `about ${money(cost)}`;

/** Where a suggested charge's power comes from, in words: "mostly solar", "a third solar", or "from the grid". */
export function solarWords(c: Pick<SuggestedCharge, "solar_share">): string {
  const s = c.solar_share;
  if (s >= 0.85) return "almost all solar";
  if (s >= 0.6) return "mostly solar";
  if (s >= 0.4) return "about half solar";
  if (s >= 0.15) return `about ${Math.round(s * 10) * 10}% solar`;
  return "no spare solar";
}

/** The car's name: what it's called, or its model, or just "Your car". */
export const carName = (v: CarView | undefined) => v?.name || v?.model?.model || "Your car";
