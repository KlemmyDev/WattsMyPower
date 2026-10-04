import type {
  CarBody,
  CarColour,
  NamedPaint,
  CarView,
  ChargeMode,
  ChargeStep,
  SuggestedCharge,
  Weekday,
} from "~/features/car/types";
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

/** Monday first, as the week is shown; Date.getDay() counts from Sunday. */
export const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const dayOf = (ts: number): Weekday => WEEKDAYS[(new Date(ts * 1000).getDay() + 6) % 7];

/**
 * The next time the car's needed (as the server picks it): `minutes` after midnight on one of `days` (every day when
 * none), at least an hour away. `skip` passes over that many, for the one after.
 */
export function nextReadyBy(now: number, minutes: number, days: Weekday[] = [], skip = 0): number {
  for (let d = 0; d < 16; d++) {
    const t = addDays(midnight(now), d) + minutes * 60;
    if (t - now >= 3600 && (!days.length || days.includes(dayOf(t))) && skip-- <= 0) return t;
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

/** A car's name: what it's called, or its model, or just "Your car". */
export const carName = (v: CarView | undefined) => v?.name || v?.model?.model || "Your car";

/** Each aim's name, and what it does, in words. */
export const MODE: Record<ChargeMode, { label: string; about: string }> = {
  cheapest: { label: "Cheapest", about: "The least on your bill, from solar, the home battery or the grid." },
  solar: {
    label: "Most solar",
    about: "Follows the sun, changing the current as it goes, and tops up from the grid at the cheapest times.",
  },
  battery: {
    label: "Spare the battery",
    about: "Never from the home battery, and only solar it doesn't need. The rest from the grid at the cheapest times.",
  },
  fastest: { label: "Fastest", about: "Starts now at full speed." },
};

export const MODES: ChargeMode[] = ["cheapest", "solar", "battery", "fastest"];

/** A plan's steps in a line: "10 A 06:30–08:00, then 20 A to 14:00"; with the day where it changes. */
export function stepsLine(steps: ChargeStep[], now?: number): string {
  const days = new Set(steps.map((s) => midnight(s.start)));
  const at = (ts: number, k: number) =>
    days.size > 1 && (k === 0 || midnight(steps[k - 1].start) !== midnight(ts))
      ? now != null
        ? when(ts, now)
        : `${weekdayLong.format(ts * 1000)} ${hhmm(ts)}`
      : hhmm(ts);
  return steps
    .map((s, k) =>
      k > 0 && steps[k - 1].end === s.start
        ? `${s.amps} A to ${hhmm(s.end)}`
        : `${s.amps} A ${at(s.start, k)}–${hhmm(s.end)}`,
    )
    .join(", then ");
}

/** Each paint's name, and its colour in the drawing. */
export const PAINT: Record<NamedPaint, { label: string; hex: string }> = {
  white: { label: "White", hex: "#f3f3f0" },
  black: { label: "Black", hex: "#202226" },
  grey: { label: "Grey", hex: "#5f646b" },
  silver: { label: "Silver", hex: "#b8bcc2" },
  blue: { label: "Blue", hex: "#2a4f8f" },
  red: { label: "Red", hex: "#a5161f" },
  green: { label: "Green", hex: "#3f5c4a" },
  sand: { label: "Sand", hex: "#cbbd9f" },
};
export const PAINTS = Object.keys(PAINT) as NamedPaint[];

/** A paint's name and colour: a named one's, or "Custom" and the colour itself. */
export const paintOf = (c: CarColour): { label: string; hex: string } =>
  c.startsWith("#") ? { label: "Custom", hex: c } : (PAINT[c as NamedPaint] ?? PAINT.white);

/** What each shape is called. */
export const BODY: Record<CarBody, string> = {
  model3: "Tesla Model 3",
  modelY: "Tesla Model Y",
  atto3: "BYD Atto 3",
  dolphin: "BYD Dolphin",
  seal: "BYD Seal",
  sealion7: "BYD Sealion 7",
  ioniq5: "Hyundai Ioniq 5",
  sedan: "Sedan",
  suv: "SUV",
  hatch: "Hatchback",
};
export const BODIES = Object.keys(BODY) as CarBody[];
