import { useQuery } from "@tanstack/react-query";
import { hhmm } from "~/features/common/formatting/utils/date";
import { centsShort, DASH, kW, kWh, money, pct, signedPct } from "~/features/common/formatting/utils/number";
import type { Snapshot } from "~/features/common/live/types";
import { costsQuery } from "~/features/common/readings/api";
import type { HistorySeries } from "~/features/common/readings/types";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, dateKey, midnight } from "~/features/common/time/utils";
import { TooltipRow } from "~/features/common/ui/components/ChartHover";
import {
  HeroBar,
  HeroCard,
  HeroFigures,
  HeroFill,
  HeroKey,
  HeroLead,
  HeroLive,
  HeroStat,
  HeroStats,
  HeroTick,
  HeroTop,
} from "~/features/common/ui/components/Hero";
import { Delta } from "~/features/common/ui/components/Live";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { TimeLine, type LinePoint } from "~/features/common/ui/components/TimeLine";
import { cn } from "~/features/common/ui/utils";
import type { Forecast } from "~/features/common/weather/types";
import { RateRow, RateStrip, rateAt } from "~/features/home/components/RateStrip";
import { useRates } from "~/features/home/hooks";
import { homeNow, homeToday, HOME, SOURCES, type Lane } from "~/features/home/utils/today";

const USUAL = alpha(COLOR.fg, 0.45);

type Today = ReturnType<typeof homeToday>;

/**
 * The house today and now, in one card, as Solar's: what it's used today and where that's heading by midnight (against
 * a usual day by now), what it's drawing now and where from (against a usual draw at this hour), the day's peak, what
 * power costs now, what the grid's cost today and how much the house made itself; today's pace along a bar; and,
 * unless `chart` is off, the day against a usual one with the rates under it and a lane for each room, hour by hour.
 */
export function HomeHero({
  p,
  f,
  series,
  start,
  now,
  lanes = [],
  chart = true,
}: {
  p: Snapshot | null;
  f: Forecast | null | undefined;
  series: HistorySeries | undefined;
  start: number;
  now: number;
  /** Today hour by hour, a lane each (todayLanes); none without smart plugs or appliances. */
  lanes?: Lane[];
  chart?: boolean;
}) {
  const live = homeNow(p, f, now);
  const today = homeToday({ p, f, series, now });
  const { data: costs } = useQuery(costsQuery(midnight(now)));
  const bill = costs?.days.find((d) => d.date === dateKey(now));
  const rates = useRates(start);
  const rate = rateAt(rates, now);
  const [usedValue, usedUnit] = today.used != null ? kWh(today.used).split(" ") : [DASH];
  const [value, unit] = kW(live.load).split(" ");
  const from = live.from.filter((x) => x.w > 50).sort((a, b) => b.w - a.w);
  const actual: LinePoint[] = series ? series.t.map((t, i) => ({ t, v: series.load_power?.[i] ?? null })) : [];
  const profile = f?.load_basis?.profile_kw;
  const usual: LinePoint[] =
    profile?.length === 24 ? profile.map((kw, h) => ({ t: start + h * 3600 + 1800, v: kw * 1000 })) : [];
  return (
    <HeroCard label="Home today and now" tint={HOME}>
      <HeroTop>
        <HeroFigures>
          <HeroLead
            label="Used today"
            value={usedValue}
            unit={usedUnit}
            sub={
              <>
                {today.used == null
                  ? "No reading yet"
                  : today.heading != null && `Heading for ${kWh(today.heading)} by midnight`}
                {today.pace != null && (
                  <Delta value={today.pace} invert>
                    {signedPct(today.pace)} on a usual day
                  </Delta>
                )}
              </>
            }
          />
          <HeroLive
            label="Using now"
            on={live.drawing}
            color={HOME}
            value={value}
            unit={unit}
            sub={
              <>
                {from.length ? (
                  <span className="inline-flex items-center gap-1.5">
                    From
                    {from.map((x, i) => (
                      <span key={x.key} className="inline-flex items-center gap-1" title={`${x.label}, ${kW(x.w)}`}>
                        <i aria-hidden className="size-1.5 rounded-full" style={{ background: SOURCES[x.key] }} />
                        {x.label.toLowerCase()}
                        {i < from.length - 1 && <span aria-hidden>·</span>}
                      </span>
                    ))}
                  </span>
                ) : (
                  live.load != null && "Next to nothing"
                )}
                {live.vsUsual != null && (
                  <Delta value={live.vsUsual} invert>
                    {signedPct(live.vsUsual)} on usual
                  </Delta>
                )}
              </>
            }
          />
        </HeroFigures>
        <HeroStats>
          <HeroStat
            label="Highest draw today"
            value={today.peak ? kW(today.peak.w) : DASH}
            sub={today.peak ? `at ${hhmm(today.peak.t)}` : undefined}
          />
          <HeroStat
            label="Power costs now"
            value={rate ? `${centsShort(rate.rate)}/kWh` : DASH}
            sub={rate ? (rates!.length > 1 ? `${rate.name} until ${hhmm(rate.to)}` : rate.name) : undefined}
          />
          <HeroStat
            label="Grid power today"
            value={bill ? money(bill.import_cost) : DASH}
            sub={bill ? `${kWh(bill.import_kwh)}${bill.saved > 0 ? ` · ${money(bill.saved)} saved` : ""}` : undefined}
          />
          <HeroStat
            label="Self-sufficiency"
            value={today.self != null ? pct(today.self * 100) : DASH}
            sub="Solar and the battery"
          />
        </HeroStats>
      </HeroTop>
      <Pace today={today} />
      {chart &&
        (series ? (
          <TimeLine
            label="Home use through the day, against a usual day"
            points={actual}
            compare={usual.length ? { points: usual, color: USUAL } : undefined}
            start={start}
            end={addDays(start, 1)}
            now={now}
            color={HOME}
            fill
            height={240}
            domain={[0, 1000]}
            every={3}
            empty="No readings today yet."
            tip={(pt, other) => (
              <>
                <span className="font-medium text-ink">{hhmm(pt.t)}</span>
                {pt.v != null && <TooltipRow label="Today" value={kW(pt.v)} color={HOME} />}
                {other?.v != null && <TooltipRow label="Usual" value={kW(other.v)} color={USUAL} />}
                <RateRow runs={rates} t={pt.t} />
                <LaneRows lanes={lanes} t={pt.t} />
              </>
            )}
            under={
              rates?.length || lanes.length
                ? (a, b, hover) => (
                    <div className="flex flex-col gap-4">
                      {rates?.length ? <RateStrip runs={rates} start={a} end={b} now={now} /> : null}
                      {lanes.length > 0 && <Lanes lanes={lanes} from={a} to={b} now={now} hover={hover} />}
                    </div>
                  )
                : undefined
            }
          />
        ) : (
          <Skeleton className="h-[300px] rounded-2xl" />
        ))}
    </HeroCard>
  );
}

/**
 * Today's pace along one bar out of where it's heading: used so far (the figure above it), the rest a usual pace
 * would add (dashed), a tick for what a usual day has used by now and a fainter one for a whole usual day.
 */
function Pace({ today: t }: { today: Today }) {
  const whole = Math.max(t.heading ?? 0, t.usualDay ?? 0, t.used ?? 0, 0.1);
  const at = (v: number) => Math.min(100, (v / whole) * 100);
  return (
    <HeroBar
      legend={
        <>
          <HeroKey mark="dot" color={HOME}>
            Used so far
          </HeroKey>
          {t.usualNow != null && <HeroKey mark="tick">{kWh(t.usualNow)} usual by now</HeroKey>}
          {t.usualDay != null && (
            <HeroKey mark="tick" color={alpha(COLOR.fg, 0.4)}>
              {kWh(t.usualDay)} on a usual day
            </HeroKey>
          )}
          {t.heading != null && (
            <HeroKey mark="dashed" color={HOME}>
              {kWh(t.heading)} by midnight
            </HeroKey>
          )}
        </>
      }
    >
      {t.heading != null && <HeroFill to={at(t.heading)} color={HOME} variant="dashed" />}
      <HeroFill to={at(t.used ?? 0)} color={HOME} />
      {t.usualNow != null && <HeroTick at={at(t.usualNow)} title="A usual day by now" />}
      {t.usualDay != null && <HeroTick at={at(t.usualDay)} color={alpha(COLOR.fg, 0.4)} title="A usual whole day" />}
    </HeroBar>
  );
}

const HOUR = 3600;

/** The hour of a lane's that holds `t`, by its index; -1 when none does. */
const hourIndex = (l: Lane, t: number) => l.t.findIndex((x) => x <= t && t < x + HOUR);

/** In the chart's tooltip: what each room (or device) used in the hour under the pointer, the most first. */
export function LaneRows({ lanes, t }: { lanes: Lane[]; t: number }) {
  const rows = lanes
    .map((l) => ({ l, v: l.kwh[hourIndex(l, t)] ?? 0 }))
    .filter((x) => x.v >= 0.005)
    .sort((a, b) => b.v - a.v)
    .slice(0, 6);
  if (!rows.length) return null;
  return (
    <>
      <span className="border-t border-line-subtle pt-1.5 text-xs text-ink-faint">
        {hhmm(t - (t % HOUR))} to {hhmm(t - (t % HOUR) + HOUR)}
      </span>
      {rows.map(({ l, v }) => (
        <TooltipRow key={l.key} label={l.label} value={kWh(v)} color={l.color} />
      ))}
    </>
  );
}

/**
 * Today hour by hour under the chart, on its time scale (zoomed with it): a lane each for the rooms (or a room's
 * devices, `by`), the car and everything else, its name and total above it, each hour lit by how much of the lane's
 * busiest hour it used. The hour under the chart's pointer stands out in every lane, the rest fade back, and each lane
 * says what it used in it.
 */
export function Lanes({
  lanes,
  from,
  to,
  now,
  hover,
  by = "room",
}: {
  lanes: Lane[];
  from: number;
  to: number;
  now: number;
  hover: number | null;
  by?: "room" | "device";
}) {
  const pc = (t: number) => ((Math.max(from, Math.min(to, t)) - from) / (to - from)) * 100;
  return (
    <div className="flex flex-col gap-2.5 border-t border-line-subtle pt-3">
      <span className="text-[11.5px] text-ink-faint">
        {hover != null
          ? `By ${by}, ${hhmm(hover - (hover % HOUR))} to ${hhmm(hover - (hover % HOUR) + HOUR)}`
          : `By ${by}, hour by hour, each lit by its own busiest hour`}
      </span>
      {lanes.map((l) => {
        const top = Math.max(0.01, ...l.kwh.map((v) => v ?? 0));
        const at = hover != null ? hourIndex(l, hover) : -1;
        return (
          <div key={l.key} className="flex flex-col gap-1">
            <span className="flex items-center gap-2 text-xs">
              <i aria-hidden className="size-2 flex-none rounded-full" style={{ background: l.color }} />
              <span className="min-w-0 flex-1 truncate text-ink-muted">{l.label}</span>
              <span className="text-ink tabular-nums">
                {at >= 0 ? (
                  <>
                    {kWh(l.kwh[at] ?? 0)}
                    <span className="text-ink-faint"> of {kWh(l.total)}</span>
                  </>
                ) : (
                  kWh(l.total)
                )}
              </span>
            </span>
            <div className="relative h-3" role="img" aria-label={`${l.label}, ${kWh(l.total)} today`}>
              {l.t.map((t, i) => {
                if (t >= to || t + HOUR <= from || t > now) return null;
                const v = l.kwh[i] ?? 0;
                return (
                  <span
                    key={t}
                    className={cn(
                      "absolute inset-y-0 rounded-[3px] transition-opacity duration-150",
                      at >= 0 && at !== i && "opacity-40",
                      at === i && "ring-1 ring-ink/70",
                    )}
                    style={{
                      left: `calc(${pc(t)}% + 1px)`,
                      width: `calc(${pc(t + HOUR) - pc(t)}% - 2px)`,
                      background:
                        v > 0.005 ? alpha(l.color, 0.08 + 0.92 * Math.min(1, v / top)) : alpha(COLOR.fg, 0.04),
                    }}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
