import { duration, hhmm, tzName } from "~/features/common/formatting/utils/date";
import { pct } from "~/features/common/formatting/utils/number";
import { ON, reserveOf } from "~/features/common/energy/utils";
import type { BatteryMode, Snapshot, SystemInfo } from "~/features/common/live/types";
import { kw, when } from "~/features/battery/utils";
import { addDays, midnight, sameDay } from "~/features/common/time/utils";
import type { Forecast } from "~/features/common/weather/types";

export type FullInfo = { eyebrow: string; headline: string; detail: string };

/** While the battery is charged at a set power (from the grid if need be), to `target` %. */
function forcedCharge(
  soc: number,
  bat: number | null | undefined,
  cap: number | null | undefined,
  target: number,
  now: number,
) {
  const secs =
    bat != null && bat < -ON && cap ? ((Math.max(0, target - soc) / 100) * cap * 3600) / (-bat / 1000) : null;
  return {
    secs,
    headline: soc >= target - 0.5 ? "Nearly there" : secs == null ? "Starting" : duration(secs),
    at: secs == null ? "" : ` at about ${hhmm(now + secs)} ${tzName}`,
  };
}

/**
 * The battery card's headline: time to reserve while discharging, otherwise time to full. When it's set to something
 * other than normal (`mode`: standby, a floor, a charge from the grid, or iSolarCloud's command), that instead.
 */
export function batteryOutlook(
  p: Snapshot | null | undefined,
  s: SystemInfo | undefined,
  f: Forecast | null | undefined,
  now: number,
  mode?: BatteryMode | null,
): FullInfo {
  const soc = p?.battery_soc;
  const bat = p?.battery_power;
  const cap = s?.battery_kwh;
  const ours = mode?.kind && !mode.ending ? mode.kind : null;
  const theirs = mode?.owner === "isolarcloud" || mode?.owner === "elsewhere" ? mode.command : null;
  const until = mode?.until ? `Until ${when(mode.until, now)}.` : "Until it's stopped.";
  if (soc != null && (ours === "standby" || theirs === "stop"))
    return {
      eyebrow: "On standby",
      headline: `Holding at ${pct(soc)}`,
      detail: `${ours ? until : "Set from iSolarCloud."} The house runs on solar and the grid, and the battery keeps its charge.`,
    };
  if (soc != null && ours === "charge" && mode?.target != null) {
    const c = forcedCharge(soc, bat, cap, mode.target, now);
    return {
      eyebrow: "Charging from the grid",
      headline: c.headline,
      detail: `Reaches ${pct(mode.target)}${c.at} at ${kw(mode.power_w)}, then goes back to normal${mode.until ? ` (or at ${when(mode.until, now)})` : ""}.`,
    };
  }
  if (soc != null && theirs === "charge") {
    const c = forcedCharge(soc, bat, cap, 100, now);
    return {
      eyebrow: "Force charging",
      headline: c.headline,
      detail: `${mode?.owner === "isolarcloud" ? "iSolarCloud is" : "Something outside the dashboard is"} charging it at ${kw(mode?.power_w)}, from the grid when solar can't cover it. Full${c.at}.`,
    };
  }
  // With a floor set here, the reserve is the floor (the inverter reports it as its reserve meanwhile).
  const word = ours === "floor" ? "floor" : "backup reserve";
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
      eyebrow: ours === "floor" ? "Estimated time to floor" : "Estimated time to reserve",
      headline: secs == null ? "—" : above ? duration(secs) : ours === "floor" ? "At the floor" : "At reserve",
      detail:
        (above ? `Reaches the ${pct(reserve)} ${word} at about ${hhmm(now + secs)} ${tzName} at this rate. ` : "") +
        parts.join(" "),
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
