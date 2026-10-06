import { useEffect, useId, useRef } from "react";
import type { BatteryState } from "~/features/common/energy/utils";
import { COLOR } from "~/features/common/theme/utils/colors";
import { cn } from "~/features/common/ui/utils";

/** The ring's proportions: its box (the viewBox's side), radius and width, and its streak's length and width (the
 * length, and how far it sinks into the charge, in hundredths of the ring). */
export type ArcSize = { box: number; r: number; width: number; streak: number; streakWidth: number; sink: number };

/** The Battery card's ring. */
export const ARC_LARGE: ArcSize = { box: 188, r: 82, width: 10, streak: 1, streakWidth: 4, sink: 5 };
/** The power flow's battery card: the same ring, small (its streak longer, to be seen at all). */
export const ARC_SMALL: ArcSize = { box: 40, r: 17, width: 3.5, streak: 5, streakWidth: 2.5, sink: 8 };

/**
 * The battery's charge as a ring (filling the box it's in): drawn in on arriving and easing to each reading, in a
 * gradient of the battery's blue (amber while it discharges). Along the empty track a small streak runs: while it
 * charges, a blue one from full back down, sinking into the charge as it fades, as if adding to it; while it
 * discharges, an amber one rising out of the charge up to full, as if drawing it off. `reserve` (0..1) marks the
 * backup reserve with a dark dot.
 */
export function BatteryArc({
  frac,
  st,
  size,
  reserve,
  className,
}: {
  frac: number;
  st: BatteryState | null;
  size: ArcSize;
  reserve?: number;
  className?: string;
}) {
  const id = useId();
  const { box, r, width } = size;
  const c = box / 2;
  const circ = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, frac));
  const discharging = st === "discharge";
  const charging = st === "charge";
  const at = f * 100;
  // The streak's run along the empty track, in hundredths of the ring: down from full to the charge while charging, up
  // from the charge to full while discharging; none when there's too little track to run along.
  const room = at < 100 - size.streak - 2;
  const into = Math.max(at - size.sink, 0);
  const run = charging && room ? [100 - size.streak, into] : discharging && room ? [into, 100 - size.streak] : null;
  const [from, to] = discharging ? [COLOR.solar, COLOR.warn] : [COLOR.battery, COLOR.batterySoft];
  return (
    <svg
      viewBox={`0 0 ${box} ${box}`}
      aria-hidden="true"
      className={cn("absolute inset-0 size-full -rotate-90 overflow-visible", className)}
    >
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: from, transition: "stop-color 600ms ease" }} />
          <stop offset="1" style={{ stopColor: to, transition: "stop-color 600ms ease" }} />
        </linearGradient>
      </defs>
      <circle cx={c} cy={c} r={r} fill="none" strokeWidth={width} style={{ stroke: COLOR.track }} />
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={`${(circ * f).toFixed(2)} ${circ.toFixed(2)}`}
        stroke={`url(#${id}-fill)`}
        className="animate-[wmpRingIn_1.2s_var(--ease-out-soft)_backwards]"
        style={{ transition: "stroke-dasharray 900ms var(--ease-out-soft)" }}
      />
      {run && (
        // keyed by where it runs, so a new reading restarts it from the right place
        <Streak
          key={`${st}-${Math.round(at)}`}
          size={size}
          from={run[0]}
          to={run[1]}
          edge={at}
          sinks={charging}
          color={charging ? COLOR.batterySoft : COLOR.solar}
        />
      )}
      {reserve != null && (
        <circle
          cx={(c + r * Math.cos(2 * Math.PI * reserve)).toFixed(1)}
          cy={(c + r * Math.sin(2 * Math.PI * reserve)).toFixed(1)}
          r={width * 0.3}
          style={{ fill: COLOR.canvas }}
        />
      )}
    </svg>
  );
}

/** One run of the streak and its rest after (ms). */
const STREAK_CYCLE = 1500;
/** The share of the cycle it runs for; it rests for the rest. */
const STREAK_RUN = 0.8;

/**
 * The streak along the ring, from `from` to `to` (hundredths of the ring), crossing the charge's end at `edge`. One
 * that `sinks` runs at full strength until it meets the charge, then fades as it carries on into it; otherwise it
 * fades in as it rises out of the charge and runs on at full strength. Where it crosses depends on the charge, so the
 * timing's worked out for each run (Web Animations rather than a fixed keyframe), and it keeps still for anyone who'd
 * rather have less motion.
 */
function Streak({
  size,
  from,
  to,
  edge,
  sinks,
  color,
}: {
  size: ArcSize;
  from: number;
  to: number;
  edge: number;
  sinks: boolean;
  color: string;
}) {
  const ref = useRef<SVGCircleElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // when, in the cycle, it meets the charge's end
    const cross = (Math.abs(edge - from) / Math.abs(to - from)) * STREAK_RUN;
    const at = (o: number) => ({ offset: o });
    const frames: Keyframe[] = sinks
      ? [
          { ...at(0), strokeDashoffset: -from, opacity: 0 },
          { ...at(Math.min(0.1, cross / 2)), opacity: 1 },
          { ...at(cross), opacity: 1 },
          { ...at(STREAK_RUN), strokeDashoffset: -to, opacity: 0 },
          { ...at(1), strokeDashoffset: -to, opacity: 0 },
        ]
      : [
          { ...at(0), strokeDashoffset: -from, opacity: 0 },
          { ...at(cross), opacity: 1 },
          { ...at(Math.max(cross, STREAK_RUN - 0.1)), opacity: 1 },
          { ...at(STREAK_RUN), strokeDashoffset: -to, opacity: 0 },
          { ...at(1), strokeDashoffset: -to, opacity: 0 },
        ];
    // after the ring has drawn in
    const anim = el.animate(frames, { duration: STREAK_CYCLE, delay: 1200, iterations: Infinity, fill: "both" });
    return () => anim.cancel();
  }, [from, to, edge, sinks]);
  const c = size.box / 2;
  return (
    <circle
      ref={ref}
      cx={c}
      cy={c}
      r={size.r}
      fill="none"
      strokeWidth={size.streakWidth}
      strokeLinecap="round"
      pathLength={100}
      strokeDasharray={`${size.streak} ${100 - size.streak}`}
      opacity={0}
      style={{ stroke: color }}
    />
  );
}
