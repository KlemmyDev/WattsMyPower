import { duration, hhmm, tzName } from "~/features/common/formatting/utils/date";
import { pct } from "~/features/common/formatting/utils/number";
import { ON, reserveOf } from "~/features/common/energy/utils";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import { addDays, midnight, sameDay } from "~/features/common/time/utils";
import type { Forecast } from "~/features/common/weather/types";

export type FullInfo = { eyebrow: string; headline: string; detail: string };

/** The battery card's headline: time to reserve while discharging, otherwise time to full. */
export function batteryOutlook(
  p: Snapshot | null | undefined,
  s: SystemInfo | undefined,
  f: Forecast | null | undefined,
  now: number,
): FullInfo {
  const soc = p?.battery_soc;
  const bat = p?.battery_power;
  const cap = s?.battery_kwh;
  if (p && bat != null && bat > ON && soc != null) {
    // Discharging: how long until the backup reserve at this rate, and when solar takes over again.
    const reserve = reserveOf(s);
    const load = p.load_power;
    const secs = cap ? (Math.max(0, ((soc - reserve) / 100) * cap) / (bat / 1000)) * 3600 : null;
    const cover = load && load > 0 ? Math.min(100, (bat / load) * 100) : null;
    const next = f?.hours.find((h) => h.start > now && h.pv_kw > h.load_kw);
    const parts = [
      cover != null ? `Covering ${pct(cover)} of your home's use right now.` : "Powering your home right now.",
    ];
    if (next) parts.push(`Solar is forecast to start charging it again from about ${hhmm(next.ts)}.`);
    const above = secs != null && soc > reserve + 0.5;
    return {
      eyebrow: "Estimated time to reserve",
      headline: secs == null ? "—" : above ? duration(secs) : "At reserve",
      detail:
        (above
          ? `Reaches the ${pct(reserve)} backup reserve at about ${hhmm(now + secs)} ${tzName} at this rate. `
          : "") + parts.join(" "),
    };
  }
  if (soc != null && soc >= 99.5)
    return { eyebrow: "Battery status", headline: "Fully charged", detail: "Excess solar now goes to the grid." };
  if (f?.summary.full_at && sameDay(f.summary.full_at, now)) {
    return {
      eyebrow: "Estimated time to full",
      headline: duration(f.summary.full_at - now),
      detail: `Full at about ${hhmm(f.summary.full_at)} ${tzName}, based on forecast solar and home use.`,
    };
  }
  if (f) {
    const endToday = addDays(midnight(now), 1);
    const sunLeft = f.hours.filter((h) => h.start < endToday && h.pv_kwh > 0.05);
    const detail = sunLeft.length
      ? `Forecast solar will bring the battery to ${pct(Math.max(...sunLeft.map((h) => h.soc)))} before sunset.`
      : f.summary.full_at
        ? `Forecast solar should fill it tomorrow at about ${hhmm(f.summary.full_at)} ${tzName}.`
        : "Forecast solar will not fill the battery in the next day.";
    return { eyebrow: "Estimated time to full", headline: "Not today", detail };
  }
  if (bat != null && bat < -ON && cap && soc != null) {
    return {
      eyebrow: "Estimated time to full",
      headline: duration(((((100 - soc) / 100) * cap) / (-bat / 1000)) * 3600),
      detail: "At the current charge rate.",
    };
  }
  return { eyebrow: "Estimated time to full", headline: "—", detail: " " };
}
