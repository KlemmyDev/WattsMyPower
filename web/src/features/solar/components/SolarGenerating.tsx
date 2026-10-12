import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { DASH, kW, kWh, pct } from "~/features/common/formatting/utils/number";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import { historyQuery } from "~/features/common/readings/api";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, dateKey, midnight } from "~/features/common/time/utils";
import { Card } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import type { Forecast } from "~/features/common/weather/types";
import { parts } from "~/features/common/widgets/parts";
import { roomOf, rowsFor } from "~/features/common/widgets/room";
import type { Settings } from "~/features/common/widgets/types";
import { Delta, LiveDot, Meter, SOLAR } from "~/features/solar/components/parts";
import { signedPct, solarNow } from "~/features/solar/utils";

/** How far back its chart goes. */
export const GENERATING_HOURS = [
  { value: "1", label: "An hour" },
  { value: "3", label: "3 hours" },
  { value: "6", label: "6 hours" },
];

/** What the card shows, given room for it. */
export type GeneratingShow = {
  /** The bar of it out of the array, with the share under it. */
  array: boolean;
  /** What the forecast expected for this hour: a tick on the bar and the change from it. */
  expected: boolean;
  /** The last hours, as a filled line. */
  chart: boolean;
  hours: "1" | "3" | "6";
  /** Made today and tomorrow's forecast along the bottom, given room. */
  today: boolean;
  tomorrow: boolean;
};

/** A widget's settings as what it shows: everything on, unless switched off. */
export function generatingShow(settings: Settings): GeneratingShow {
  const hours = GENERATING_HOURS.find((o) => o.value === settings.hours)?.value ?? "3";
  return {
    array: settings.array !== false,
    expected: settings.expected !== false,
    chart: settings.chart !== false,
    hours: hours as GeneratingShow["hours"],
    today: settings.today !== false,
    tomorrow: settings.tomorrow !== false,
  };
}
const ALL = generatingShow({});

const HEAD = 28 + 12;
const FIGURE = 56 + 12;
const BAR = 6 + 8 + 16 + 12;
const FACTS = 1 + 12 + 40;

/** The most rows the card can use for what it shows: with its chart, any (the chart takes what's left). */
export function generatingRows(show: GeneratingShow, w: number) {
  if (show.chart) return undefined;
  return rowsFor(HEAD + FIGURE + (show.array ? BAR : 0) + ((show.today || show.tomorrow) && w >= 3 ? FACTS : 0));
}

/**
 * What the panels are making now, for a dashboard, fitted to its size: the figure, a bar of it out of the array with a
 * tick for what the forecast expected this hour, the last hours as a filled line, and made today and tomorrow along
 * the bottom. At its smallest (2 × 2) it's the figure and the bar; wide and short, the line goes beside the figure;
 * taller, under it, taking what room is left. The card takes a glow of the sun's colour from its corner while the
 * panels make power, and the moon's while they rest. `show` leaves any of it out.
 */
export function SolarGenerating({
  p,
  s,
  f,
  now,
  w = 3,
  h = 3,
  show = ALL,
}: {
  p: Snapshot | null;
  s: SystemInfo | undefined;
  f: Forecast | null | undefined;
  now: number;
  w?: number;
  h?: number;
  show?: GeneratingShow;
}) {
  const live = solarNow(p, s, f, now);
  const { wide, tall } = roomOf(w, h);
  const tint = live.producing ? SOLAR : COLOR.moon;
  const [value, unit] = parts(kW(live.pv));
  const whole = live.array ? live.array * 1000 : null;
  const short = tall === "short";
  // Wide and short: the line beside the figure rather than under it.
  const beside = short && w >= 5;
  const big = beside || (!short && wide !== "xs");
  const tomorrow = f?.days.find((d) => d.date === dateKey(addDays(midnight(now), 1)));
  const facts = [
    show.today && { label: "Made today", value: kWh(p?.daily_pv) },
    show.tomorrow && { label: "Tomorrow", value: tomorrow ? kWh(tomorrow.pv_kwh) : DASH },
  ].filter(Boolean) as { label: string; value: string }[];

  const figure = (
    <span className="flex items-baseline gap-1 font-light text-ink tabular-nums">
      <span
        className={cn(
          big
            ? "text-[56px] leading-14 tracking-[-2.5px] max-sm:text-[44px] max-sm:leading-11"
            : "text-[40px] leading-11 tracking-[-1.5px] max-sm:text-[32px] max-sm:leading-9",
        )}
      >
        {value}
      </span>
      {unit && <span className={cn("font-normal text-ink-faint", big ? "text-lg" : "text-[15px]")}>{unit}</span>}
    </span>
  );
  const bar = show.array && whole != null && (
    <div className="flex flex-col gap-2">
      <Meter
        share={live.share ?? 0}
        color={tint}
        mark={
          show.expected && live.expected != null
            ? { at: live.expected / whole, label: `Expected now, ${kW(live.expected)}` }
            : undefined
        }
      />
      {!(short && !beside) && (
        <span className="flex justify-between gap-2 text-xs text-ink-faint tabular-nums">
          <span className="truncate">
            {live.share != null ? `${pct(live.share * 100)} of ${live.array} kW` : `${live.array} kW array`}
          </span>
          {show.expected && live.expected != null && wide !== "xs" && (
            <span className="whitespace-nowrap">Expected {kW(live.expected)}</span>
          )}
        </span>
      )}
    </div>
  );
  const chart = show.chart && (beside || !short) && (
    <Recent now={now} hours={+show.hours} color={tint} label={!beside && tall === "tall"} />
  );

  return (
    <Card
      aria-label="Solar generating now"
      className="h-full gap-3 overflow-hidden p-5 max-sm:p-4"
      style={{
        backgroundImage: `radial-gradient(circle at 0% 0%, ${alpha(tint, live.producing ? 0.2 : 0.1)}, transparent 65%)`,
      }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="flex size-7 flex-none items-center justify-center rounded-[9px] transition-colors duration-500"
          style={{ background: alpha(tint, 0.16), color: tint }}
        >
          <Icon name={live.producing ? "sun" : "moon"} size={15} />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-ink-muted">
          <LiveDot on={live.producing} color={tint} />
          <span className="truncate">{live.producing ? "Generating" : "Resting"}</span>
        </span>
        {show.expected && live.vsExpected != null && wide !== "xs" && (
          <Delta value={live.vsExpected}>
            {signedPct(live.vsExpected)}
            {w >= 4 ? " on expected" : ""}
          </Delta>
        )}
      </div>
      {beside ? (
        <div className="flex min-h-0 flex-1 items-end gap-5">
          {figure}
          <div className="flex min-w-0 flex-1 flex-col justify-end gap-2">
            {chart}
            {bar}
          </div>
        </div>
      ) : (
        <>
          {figure}
          {bar}
          {chart}
          {tall === "tall" && facts.length > 0 && w >= 3 && (
            <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-line-subtle pt-3">
              {facts.map((x) => (
                <div key={x.label} className="flex min-w-0 flex-col">
                  <dt className="truncate text-[11.5px] text-ink-faint">{x.label}</dt>
                  <dd className="text-[17px] font-light tabular-nums">{x.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </Card>
  );
}

/** The last `hours` of solar as a filled line, scaled to its own highest (the bar shows it against the array). */
function Recent({ now, hours, color, label }: { now: number; hours: number; color: string; label: boolean }) {
  const id = useId().replace(/:/g, "");
  const end = now - (now % 300);
  const start = end - hours * 3600;
  const { data } = useQuery(historyQuery({ start, end, points: hours * 12, fields: ["pv_power"], live: true }));
  const t = data?.series.t ?? [];
  const v = data?.series.pv_power ?? [];
  const pts = t.flatMap((x, i) => (v[i] != null ? [{ t: x, v: v[i]! }] : []));
  const hi = Math.max(100, ...pts.map((x) => x.v)) * 1.15;
  const W = 200;
  const H = 60;
  const xy = (x: { t: number; v: number }) =>
    `${(((x.t - start) / (end - start)) * W).toFixed(1)} ${(H - 1 - (x.v / hi) * (H - 4)).toFixed(1)}`;
  const line = pts.map((x, i) => `${i ? "L" : "M"}${xy(x)}`).join(" ");
  return (
    <div className="flex min-h-10 flex-1 flex-col gap-1">
      <div className="relative min-h-0 flex-1">
        {pts.length > 1 && (
          <svg
            aria-hidden
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
          >
            <defs>
              <linearGradient id={`${id}-f`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={color} stopOpacity="0.28" />
                <stop offset="1" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d={`${line} L${xy(pts[pts.length - 1]).split(" ")[0]} ${H} L${xy(pts[0]).split(" ")[0]} ${H} Z`}
              fill={`url(#${id}-f)`}
            />
            <path
              d={line}
              fill="none"
              strokeWidth={1.75}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              style={{ stroke: color }}
            />
          </svg>
        )}
      </div>
      {label && (
        <span className="text-[11px] text-ink-faint">{hours === 1 ? "The last hour" : `The last ${hours} hours`}</span>
      )}
    </div>
  );
}
