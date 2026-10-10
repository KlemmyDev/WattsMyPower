import type { Tariff, TariffBand, TimeWindow } from "~/features/common/tariffs/types";
import { isWeekend, partsOf } from "~/features/common/time/utils";
import { COLOR } from "~/features/common/theme/utils/colors";

export const BAND_COLORS = [COLOR.solar, COLOR.battery, COLOR.gridLine, COLOR.good, COLOR.lilac, COLOR.bad];
export const bandColor = (i: number) => BAND_COLORS[i % BAND_COLORS.length];
export const MAX_BANDS = 6;
export const MAX_WINDOWS = 6;

export const DAY_OPTIONS: [TimeWindow["days"], string][] = [
  ["all", "Every day"],
  ["weekdays", "Weekdays"],
  ["weekends", "Weekends"],
];

export type DayKind = "weekday" | "weekend";

const num = (v: number | "") => (v === "" ? 0 : v);

export function toMinutes(t: string): number {
  const [h, m] = String(t || "0:0")
    .split(":")
    .map(Number);
  return (h || 0) * 60 + (m || 0);
}

function bandsOf(t: Tariff): TariffBand[] {
  return t.type === "tou" ? t.bands : [{ name: "All times", rate: t.flat_rate, other: true, windows: [] }];
}

/**
 * Which band applies at each minute of a weekday or weekend day. The first matching window wins
 * (the server rejects overlaps); minutes no window covers use the band marked `other`.
 */
export function bandTable(t: Tariff, kind: DayKind): { bands: TariffBand[]; tab: number[] } {
  const bands = bandsOf(t);
  const other = Math.max(
    0,
    bands.findIndex((b) => b.other),
  );
  const tab = new Array<number>(1440).fill(other);
  const set = new Array<boolean>(1440).fill(false);
  bands.forEach((b, i) => {
    if (b.other) return;
    for (const w of b.windows || []) {
      if (w.days !== "all" && w.days.slice(0, -1) !== kind) continue;
      const end = toMinutes(w.end);
      let m = toMinutes(w.start); // equal start and end = the whole day
      do {
        if (!set[m]) {
          tab[m] = i;
          set[m] = true;
        }
        m = (m + 1) % 1440;
      } while (m !== end);
    }
  });
  return { bands, tab };
}

/** Indexes of bands that apply at some minute of the week (a band can be fully covered by others). */
export const usedBands = (t: Tariff) => new Set([...bandTable(t, "weekday").tab, ...bandTable(t, "weekend").tab]);

/** The band in force at a moment. */
export function bandAt(t: Tariff, ts: number): { name: string; rate: number } {
  const p = partsOf(ts);
  const { bands, tab } = bandTable(t, isWeekend(ts) ? "weekend" : "weekday");
  const b = bands[tab[p.hour * 60 + p.minute]];
  return { name: b.name, rate: num(b.rate) };
}

/** When a time-of-use band applies: "16:00 to 21:00", "Weekdays 07:00 to 09:00", or "All other times". */
export function bandHours(b: TariffBand): string {
  if (b.other) return "All other times";
  return b.windows
    .map((w) => {
      const days = w.days === "all" ? "" : `${DAY_OPTIONS.find(([d]) => d === w.days)?.[1]} `;
      return days + (w.start === w.end ? (days ? "all day" : "All day") : `${w.start} to ${w.end}`);
    })
    .join(", ");
}

/** A starting set of time-of-use bands when switching from a single rate. */
export function seedBands(t: Tariff): TariffBand[] {
  const r = num(t.flat_rate) || 0.32;
  const f2 = (x: number) => Math.round(x * 100) / 100;
  return [
    { name: "Peak", rate: f2(r * 1.4), windows: [{ days: "all", start: "16:00", end: "21:00" }] },
    { name: "Off-peak", rate: f2(r * 0.7), windows: [{ days: "all", start: "21:00", end: "07:00" }] },
    { name: "Shoulder", rate: r, other: true, windows: [] },
  ];
}

export const tariffNumber = num;
