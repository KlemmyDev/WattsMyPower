import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { energyToday } from "~/features/common/energy/utils";
import { centsShort, DASH, kW, kWh, signedPct } from "~/features/common/formatting/utils/number";
import type { Snapshot } from "~/features/common/live/types";
import { historyQuery } from "~/features/common/readings/api";
import { alpha } from "~/features/common/theme/utils/colors";
import { midnight } from "~/features/common/time/utils";
import { Card } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { Delta, LiveDot } from "~/features/common/ui/components/Live";
import { cn } from "~/features/common/ui/utils";
import type { Forecast } from "~/features/common/weather/types";
import { parts } from "~/features/common/widgets/parts";
import { roomOf, rowsFor } from "~/features/common/widgets/room";
import type { Settings } from "~/features/common/widgets/types";
import { rateAt } from "~/features/home/components/RateStrip";
import { useRates } from "~/features/home/hooks";
import { homeNow, HOME, SOURCES } from "~/features/home/utils/today";

/** How far back its line goes. */
export const USING_HOURS = [
  { value: "1", label: "An hour" },
  { value: "3", label: "3 hours" },
  { value: "6", label: "6 hours" },
];

/** What the card shows, given room for it. */
export type UsingShow = {
  /** Where it's coming from, as a bar. */
  sources: boolean;
  /** Against what it usually draws at this hour. */
  usual: boolean;
  chart: boolean;
  hours: "1" | "3" | "6";
  /** Used today and what power costs now along the bottom, given room. */
  today: boolean;
  price: boolean;
};

/** A widget's settings as what it shows: everything on, unless switched off. */
export function usingShow(settings: Settings): UsingShow {
  const hours = USING_HOURS.find((o) => o.value === settings.hours)?.value ?? "3";
  return {
    sources: settings.sources !== false,
    usual: settings.usual !== false,
    chart: settings.chart !== false,
    hours: hours as UsingShow["hours"],
    today: settings.today !== false,
    price: settings.price !== false,
  };
}
const ALL = usingShow({});

const HEAD = 28 + 12;
const FIGURE = 56 + 12;
const BAR = 8 + 8 + 16 + 12;
const FACTS = 1 + 12 + 40;

/** The most rows the card can use for what it shows: with its line, any (the line takes what's left). */
export function usingRows(show: UsingShow, w: number) {
  if (show.chart) return undefined;
  return rowsFor(HEAD + FIGURE + (show.sources ? BAR : 0) + ((show.today || show.price) && w >= 3 ? FACTS : 0));
}

/**
 * What the house is drawing now, for a dashboard, fitted to its size: the figure, where it's coming from as a bar, how
 * it compares with a usual draw at this hour, the last hours as a filled line, and used today and the price now along
 * the bottom. At its smallest (2 × 2) it's the figure and the bar; wide and short, the line goes beside the figure;
 * taller, under it. The card takes a glow of the house's colour from its corner. `show` leaves any of it out.
 */
export function HomeUsing({
  p,
  f,
  now,
  w = 3,
  h = 3,
  show = ALL,
}: {
  p: Snapshot | null;
  f: Forecast | null | undefined;
  now: number;
  w?: number;
  h?: number;
  show?: UsingShow;
}) {
  const live = homeNow(p, f, now);
  const { wide, tall } = roomOf(w, h);
  const short = tall === "short";
  const beside = short && w >= 5;
  const big = beside || (!short && wide !== "xs");
  const [value, unit] = parts(kW(live.load));
  const rate = rateAt(useRates(midnight(now)), now);
  const used = energyToday(p)?.home ?? null;
  const total = live.from.reduce((a, x) => a + x.w, 0);
  const facts = [
    show.today && { label: "Used today", value: kWh(used) },
    show.price && { label: "Power costs now", value: rate ? `${centsShort(rate.rate)}/kWh` : DASH },
  ].filter(Boolean) as { label: string; value: string }[];

  const figure = (
    <span className="flex items-baseline gap-1 font-light text-ink tabular-nums">
      <span
        className={
          big
            ? "text-[56px] leading-14 tracking-[-2.5px] max-sm:text-[44px] max-sm:leading-11"
            : "text-[40px] leading-11 tracking-[-1.5px] max-sm:text-[32px] max-sm:leading-9"
        }
      >
        {value}
      </span>
      {unit && <span className={cn("font-normal text-ink-faint", big ? "text-lg" : "text-[15px]")}>{unit}</span>}
    </span>
  );
  const bar = show.sources && total > 0 && (
    <div className="flex flex-col gap-2">
      <div
        className="flex h-2 gap-0.5"
        role="img"
        aria-label={live.from.map((x) => `${x.label} ${kW(x.w)}`).join(", ")}
      >
        {live.from
          .filter((x) => x.w > 0)
          .map((x) => (
            <span
              key={x.key}
              className="transition-[flex-grow] duration-700 ease-out-soft first:rounded-l-full last:rounded-r-full"
              style={{ flexGrow: x.w, background: SOURCES[x.key] }}
            />
          ))}
      </div>
      {!(short && !beside) && (
        <span className="flex justify-between gap-2 text-xs text-ink-faint tabular-nums">
          {live.from
            .filter((x) => x.w > 50 || wide !== "xs")
            .slice(0, wide === "xs" ? 1 : 3)
            .map((x) => (
              <span key={x.key} className="truncate">
                {x.label} {kW(x.w)}
              </span>
            ))}
        </span>
      )}
    </div>
  );
  const chart = show.chart && (beside || !short) && (
    <Recent now={now} hours={+show.hours} label={!beside && tall === "tall"} />
  );

  return (
    <Card
      aria-label="The house using now"
      className="h-full gap-3 overflow-hidden p-5 max-sm:p-4"
      style={{ backgroundImage: `radial-gradient(circle at 0% 0%, ${alpha(HOME, 0.2)}, transparent 65%)` }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="flex size-7 flex-none items-center justify-center rounded-[9px]"
          style={{ background: alpha(HOME, 0.16), color: HOME }}
        >
          <Icon name="home" size={15} />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-ink-muted">
          <LiveDot on={live.drawing} color={HOME} />
          <span className="truncate">Using now</span>
        </span>
        {show.usual && live.vsUsual != null && wide !== "xs" && (
          <Delta value={live.vsUsual} invert>
            {signedPct(live.vsUsual)}
            {w >= 4 ? " on usual" : ""}
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

/** The last `hours` of the house's draw as a filled line, scaled to its own highest. */
function Recent({ now, hours, label }: { now: number; hours: number; label: boolean }) {
  const id = useId().replace(/:/g, "");
  const end = now - (now % 300);
  const start = end - hours * 3600;
  const { data } = useQuery(historyQuery({ start, end, points: hours * 12, fields: ["load_power"], live: true }));
  const t = data?.series.t ?? [];
  const v = data?.series.load_power ?? [];
  const pts = t.flatMap((x, i) => (v[i] != null ? [{ t: x, v: Math.max(0, v[i]!) }] : []));
  const hi = Math.max(100, ...pts.map((x) => x.v)) * 1.15;
  const W = 200;
  const H = 60;
  const x = (p: { t: number }) => ((p.t - start) / (end - start)) * W;
  const y = (p: { v: number }) => H - 1 - (p.v / hi) * (H - 4);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p).toFixed(1)} ${y(p).toFixed(1)}`).join(" ");
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
                <stop offset="0" stopColor={HOME} stopOpacity="0.28" />
                <stop offset="1" stopColor={HOME} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d={`${line} L${x(pts[pts.length - 1]).toFixed(1)} ${H} L${x(pts[0]).toFixed(1)} ${H} Z`}
              fill={`url(#${id}-f)`}
            />
            <path
              d={line}
              fill="none"
              strokeWidth={1.75}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              style={{ stroke: HOME }}
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
