import type { BatteryMode } from "~/features/common/live/types";
import { hhmm, shortDay } from "~/features/common/formatting/utils/date";

/** Unix seconds of the next `hh:mm` (local) after `now`: today, or tomorrow if that's already passed. */
export function nextAt(hm: string, now: number): number | null {
  const [h, m] = hm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const d = new Date(now * 1000);
  d.setHours(h, m, 0, 0);
  if (d.getTime() / 1000 <= now + 60) d.setDate(d.getDate() + 1);
  return Math.floor(d.getTime() / 1000);
}

/** "14:05", "tomorrow 06:00", or "Thu 9 Oct 06:00". */
export function when(ts: number, now: number): string {
  const day = (t: number) => new Date(t * 1000).toDateString();
  if (day(ts) === day(now)) return hhmm(ts);
  if (day(ts) === day(now + 86400)) return `tomorrow ${hhmm(ts)}`;
  return `${shortDay.format(new Date(ts * 1000))} ${hhmm(ts)}`;
}

export const kw = (w: number | null | undefined) => `${((w ?? 0) / 1000).toFixed(1)} kW`;

/** The battery's mode in a word or two ("Standby", "Floor 40%", "iSolarCloud"), what it means in a few more, and
 * whether it's anything but normal. */
export type ModeText = { label: string; detail: string | null; special: boolean };

export function describeMode(m: BatteryMode, now: number): ModeText {
  const until = (ts: number | null | undefined) => (ts ? `until ${when(ts, now)}` : "until you stop it");
  if (m.kind && !m.ending) {
    if (m.kind === "standby") return { label: "Standby", detail: until(m.until), special: true };
    if (m.kind === "floor") return { label: `Floor ${m.floor}%`, detail: until(m.until), special: true };
    return {
      label: "Grid charge",
      detail: `to ${m.target}% at ${kw(m.power_w)}${m.until ? `, ${until(m.until)}` : ""}`,
      special: true,
    };
  }
  switch (m.owner) {
    case "normal":
      return { label: "Normal", detail: m.min_soc != null ? `keeps ${m.min_soc}% in reserve` : null, special: false };
    case "isolarcloud":
      return {
        label: "iSolarCloud",
        detail:
          m.command === "charge"
            ? `force charging at ${kw(m.power_w)}`
            : m.command === "discharge"
              ? `force discharging at ${kw(m.power_w)}`
              : m.command === "stop"
                ? "on standby"
                : "in control",
        special: true,
      };
    case "external":
      return { label: "External control", detail: "an energy manager has the battery", special: true };
    case "elsewhere":
      return { label: "Forced mode", detail: "set outside the dashboard", special: true };
    case "unknown":
      return { label: "Unknown mode", detail: null, special: true };
    default:
      return { label: "Not read yet", detail: null, special: false };
  }
}
