import type { ControlKind, ControlRecord, OutsideKind } from "~/features/battery/types";
import type { BatteryMode } from "~/features/common/live/types";
import { COLOR } from "~/features/common/theme/utils/colors";
import { hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { addDays, partsOf, sameDay, siteTime } from "~/features/common/time/utils";

/** Unix seconds of the next `hh:mm` (on the site's clock) after `now`: today, or tomorrow if that's already passed. */
export function nextAt(hm: string, now: number): number | null {
  const [h, m] = hm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const d = partsOf(now);
  const at = siteTime(d.year, d.month, d.day, h, m);
  return at <= now + 60 ? siteTime(d.year, d.month, d.day + 1, h, m) : at;
}

/** "14:05", "tomorrow 06:00", or "Thu 9 Oct 06:00". */
export function when(ts: number, now: number): string {
  if (sameDay(ts, now)) return hhmm(ts);
  if (sameDay(ts, addDays(now, 1))) return `tomorrow ${hhmm(ts)}`;
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
    if (m.kind === "floor") return { label: `Reserve ${m.floor}%`, detail: until(m.until), special: true };
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

export const KIND_LABEL: Record<ControlKind | OutsideKind, string> = {
  standby: "Standby",
  floor: "Reserve",
  charge: "Grid charge",
  isolarcloud: "iSolarCloud",
  external: "Energy manager",
  elsewhere: "Set elsewhere",
};

/** Each control's colour on the chart and its tile (theme tokens, so it follows light and dark). */
export const KIND_COLOR: Record<ControlKind | OutsideKind, string> = {
  standby: COLOR.inkMuted,
  floor: COLOR.lilac,
  charge: COLOR.import,
  // Anything not from the dashboard: one colour, as the controls here are off meanwhile.
  isolarcloud: COLOR.warn,
  external: COLOR.warn,
  elsewhere: COLOR.warn,
};

const OUTSIDE_DOING = { charge: "force charge", discharge: "force discharge", stop: "standby" } as const;

/** A control as it ran, in a few words: "Standby", "Reserve 40%", "Grid charge to 80%", "iSolarCloud force charge". */
export function recordLabel(c: Pick<ControlRecord, "kind" | "floor" | "target" | "command">): string {
  if (c.kind === "isolarcloud" || c.kind === "external" || c.kind === "elsewhere")
    return c.command ? `${KIND_LABEL[c.kind]} ${OUTSIDE_DOING[c.command]}` : KIND_LABEL[c.kind];
  if (c.kind === "floor" && c.floor != null) return `Reserve ${c.floor}%`;
  if (c.kind === "charge" && c.target != null) return `Grid charge to ${c.target}%`;
  return KIND_LABEL[c.kind];
}

/** The icon for what the battery is set to do, when that's anything but normal: pause (standby), shield (a raised
 * reserve), bolt (a charge from the grid), cloud (iSolarCloud's command), lock (another controller). */
export function modeIcon(m: BatteryMode | null): "pause" | "shield" | "bolt" | "cloud" | "lock" | null {
  if (!m) return null;
  if (m.kind && !m.ending) return m.kind === "standby" ? "pause" : m.kind === "floor" ? "shield" : "bolt";
  if (m.owner === "isolarcloud") return "cloud";
  if (m.owner === "external" || m.owner === "elsewhere" || m.owner === "unknown") return "lock";
  return null;
}

/** Whether the battery is as full as it's allowed to get (its max SOC), so there's nothing to charge. */
export const isFull = (soc: number | null | undefined, top: number | null | undefined) =>
  soc != null && soc >= (top ?? 100) - 0.5;
