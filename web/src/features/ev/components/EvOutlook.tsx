import { clock, duration, hhmm } from "~/features/common/formatting/utils/date";
import { kW } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { useNow } from "~/features/common/time/hooks";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import type { EvOutlook, EvVehicle } from "~/features/ev/types";

/** A wait in words: "45 s", "3 min", "1 h 5 min". */
const span = (secs: number) => (secs < 60 ? `${Math.max(0, Math.round(secs))} s` : duration(secs));

/** A ring `share` full (0 to 1) in `color`, round an icon; spinning a short arc while `busy`. */
function Ring({ share, color, icon, busy }: { share: number; color: string; icon: IconName; busy?: boolean }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const shown = busy ? 0.25 : Math.max(0, Math.min(1, share));
  return (
    <span className="relative flex size-12 flex-none items-center justify-center" style={{ color }}>
      <svg
        viewBox="0 0 48 48"
        className={cn("absolute inset-0 size-full -rotate-90", busy && "animate-spin")}
        aria-hidden
      >
        <circle cx="24" cy="24" r={r} fill="none" strokeWidth="3.5" style={{ stroke: alpha(color, 0.16) }} />
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
          className="transition-[stroke-dashoffset] duration-1000 ease-linear"
          style={{ stroke: color }}
        />
      </svg>
      <Icon name={icon} size={18} />
    </span>
  );
}

/** What to say for each state of the outlook, now: its ring, a headline and a line on why. */
function words(o: EvOutlook, v: EvVehicle, live: number | null, now: number) {
  const c = v.control;
  const left = o.at != null ? o.at - now : null;
  const soon = (what: string) => (left == null || left <= 0 ? `${what} any moment` : `${what} in ${clock(left)}`);
  const perAmp = v.volts && v.phases ? v.volts * v.phases : null;
  switch (o.state) {
    case "measuring":
      return {
        icon: "sun" as IconName,
        color: COLOR.inkMuted,
        busy: true,
        share: 0,
        head: "Measuring the spare sun",
        why: `It goes by the last ${span(c.average)} of readings, so a moment's change doesn't start or stop it.`,
      };
    case "short":
      return {
        icon: "sun" as IconName,
        color: COLOR.inkMuted,
        share: live != null ? live / o.start_w : 0,
        // The forecast's next stretch of enough sun, counted down to.
        head:
          v.solar_from != null && v.solar_from > now
            ? `Enough sun expected in ${v.solar_from - now < 3600 ? clock(v.solar_from - now) : span(v.solar_from - now)}`
            : `Needs ${kW(o.start_w)} of spare sun to start`,
        why: `${
          v.solar_from != null && v.solar_from > now ? `The forecast has enough from ${hhmm(v.solar_from)}. ` : ""
        }It starts once ${kW(o.start_w)} has been spare for ${span(c.start_after)} straight.`,
      };
    case "counting": {
      const since = o.since ?? now;
      const whole = Math.max(1, (o.at ?? now) - since);
      return {
        icon: "bolt" as IconName,
        color: COLOR.solar,
        share: (now - since) / whole,
        head: soon("Starting"),
        why:
          o.wait === "switch"
            ? `There's enough sun, but it stopped not long ago: it waits ${span(c.min_switch)} between stopping and starting again, to spare the car's charging hardware. Then ${o.amps} A.`
            : `Enough sun for ${span(now - since)} so far. It waits for ${span(c.start_after)} of steady sun, so a gap in the clouds doesn't start it. Then ${o.amps} A${perAmp && o.amps ? ` (${kW(o.amps * perAmp)})` : ""}.`,
      };
    }
    case "stopping": {
      const since = o.since ?? now;
      const whole = Math.max(1, (o.at ?? now) - since);
      return {
        icon: "cloud" as IconName,
        color: COLOR.warn,
        share: 1 - (now - since) / whole,
        head: soon("Stopping"),
        why: `Short of sun for ${span(now - since)}. It stops after ${span(c.stop_after)} unless there's ${kW(o.floor_w)} spare again.`,
      };
    }
    default: {
      const s = v.state;
      const changing = o.target != null && o.target !== s?.amps;
      return {
        icon: "bolt" as IconName,
        color: COLOR.solar,
        share: 1,
        head: changing ? soon(`Going to ${o.target} A`) : `Following the sun at ${s?.amps ?? o.target} A`,
        why: `It keeps going while ${kW(o.floor_w)} or more is spare${
          v.control.grid_w ? ` (borrowing up to ${kW(v.control.grid_w)} through a cloud)` : ""
        }, and changes speed at most every ${span(c.amps_every)}.`,
      };
    }
  }
}

/**
 * What's next for a car charging from the sun, plainly: a ring and a headline saying what it's waiting on and when it'll
 * act ("Starting in 1:42", "Stopping in 3:40", "Needs 1.2 kW of spare sun to start"), and a line on why, from the waits
 * it's set to. Counts down each second on its own.
 */
export function SolarOutlook({ v, live }: { v: EvVehicle; live: number | null }) {
  const now = useNow(1000);
  const o = v.outlook;
  if (!o) return null;
  const w = words(o, v, live, now);
  return (
    <div
      className="flex items-center gap-4 rounded-2xl border px-4 py-3.5"
      style={{ borderColor: alpha(w.color, 0.3), background: alpha(w.color, 0.07) }}
      role="status"
      aria-live="off"
    >
      <Ring share={w.share} color={w.color} icon={w.icon} busy={w.busy} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[17px] leading-6 font-semibold text-ink tabular-nums">{w.head}</span>
        <span className="text-[13px] text-pretty text-ink-muted">{w.why}</span>
      </div>
    </div>
  );
}
