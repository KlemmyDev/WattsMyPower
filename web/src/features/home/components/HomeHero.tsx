import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { hhmm } from "~/features/common/formatting/utils/date";
import { centsShort, DASH, kW, kWh, money, pct, signedPct } from "~/features/common/formatting/utils/number";
import type { Snapshot } from "~/features/common/live/types";
import { costsQuery } from "~/features/common/readings/api";
import type { HistorySeries } from "~/features/common/readings/types";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, dateKey, midnight } from "~/features/common/time/utils";
import { Card } from "~/features/common/ui/components/Card";
import { TooltipRow } from "~/features/common/ui/components/ChartHover";
import { Delta, Figure, LiveDot } from "~/features/common/ui/components/Live";
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
    <Card
      aria-label="Home today and now"
      className="h-full gap-6"
      style={{ backgroundImage: `linear-gradient(180deg, ${alpha(HOME, 0.1)}, transparent 45%)` }}
    >
      {/* On a phone the rows below come apart (contents) so the pace bar can sit right under what's been used. */}
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5 max-sm:contents">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-5 max-sm:contents">
          <div className="flex flex-col gap-1.5 max-sm:-order-2">
            <span className="text-[13px] text-ink-muted">Used today</span>
            <Figure value={usedValue} unit={usedUnit} size="xl" />
            <span className="flex flex-wrap items-center gap-2 text-[13px] text-ink-muted tabular-nums">
              {today.used == null
                ? "No reading yet"
                : today.heading != null && `Heading for ${kWh(today.heading)} by midnight`}
              {today.pace != null && (
                <Delta value={today.pace} invert>
                  {signedPct(today.pace)} on a usual day
                </Delta>
              )}
            </span>
          </div>
          <div className="flex flex-col gap-1.5 border-l border-line-subtle pl-6 max-sm:border-l-0 max-sm:pl-0">
            <span className="flex items-center gap-2 text-[13px] text-ink-muted">
              <LiveDot on={live.drawing} color={HOME} />
              Using now
            </span>
            <Figure value={value} unit={unit} />
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted tabular-nums">
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
            </span>
          </div>
        </div>
        <dl className="grid grid-cols-4 gap-x-8 gap-y-3 max-md:grid-cols-2">
          <Stat
            label="Peak today"
            value={today.peak ? kW(today.peak.w) : DASH}
            sub={today.peak ? `at ${hhmm(today.peak.t)}` : undefined}
          />
          <Stat
            label="Power costs now"
            value={rate ? `${centsShort(rate.rate)}/kWh` : DASH}
            sub={rate ? (rates!.length > 1 ? `${rate.name} until ${hhmm(rate.to)}` : rate.name) : undefined}
          />
          <Stat
            label="Grid power today"
            value={bill ? money(bill.import_cost) : DASH}
            sub={bill ? `${kWh(bill.import_kwh)}${bill.saved > 0 ? ` · ${money(bill.saved)} saved` : ""}` : undefined}
          />
          <Stat
            label="Made itself"
            value={today.self != null ? pct(today.self * 100) : DASH}
            sub="Solar and the battery"
          />
        </dl>
      </div>
      <Pace today={today} className="max-sm:-order-1" />
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
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="text-[20px] leading-6 font-light tracking-[-0.3px] whitespace-nowrap tabular-nums">{value}</dd>
      {sub && <dd className="truncate text-[11.5px] text-ink-faint">{sub}</dd>}
    </div>
  );
}

/**
 * Today's pace along one bar out of where it's heading: used so far (the figure above it), the rest a usual pace
 * would add (dashed), a tick for what a usual day has used by now and a fainter one for a whole usual day.
 */
function Pace({ today: t, className }: { today: Today; className?: string }) {
  const whole = Math.max(t.heading ?? 0, t.usualDay ?? 0, t.used ?? 0, 0.1);
  const at = (v: number) => `${Math.min(100, (v / whole) * 100)}%`;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="relative h-2.5 rounded-full bg-track">
        {t.heading != null && (
          <span
            className="absolute inset-y-0 left-0 rounded-full border border-dashed"
            style={{ width: at(t.heading), borderColor: alpha(HOME, 0.7) }}
          />
        )}
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out-soft"
          style={{ width: at(t.used ?? 0), background: HOME }}
        />
        {t.usualNow != null && (
          <span
            title="A usual day by now"
            className="absolute -inset-y-1.5 w-0.5 -translate-x-1/2 rounded-full bg-ink"
            style={{ left: at(t.usualNow) }}
          />
        )}
        {t.usualDay != null && (
          <span
            title="A usual whole day"
            className="absolute -inset-y-1.5 w-0.5 -translate-x-1/2 rounded-full bg-fg/40"
            style={{ left: at(t.usualDay) }}
          />
        )}
      </div>
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-ink-faint tabular-nums">
        <span className="flex items-center gap-1.5">
          <i className="size-2 rounded-full" style={{ background: HOME }} />
          Used so far
        </span>
        {t.usualNow != null && (
          <span className="flex items-center gap-1.5">
            <i className="h-2.5 w-0.5 rounded-full bg-ink" />
            {kWh(t.usualNow)} usual by now
          </span>
        )}
        {t.usualDay != null && (
          <span className="flex items-center gap-1.5">
            <i className="h-2.5 w-0.5 rounded-full bg-fg/40" />
            {kWh(t.usualDay)} on a usual day
          </span>
        )}
        {t.heading != null && (
          <span className="flex items-center gap-1.5">
            <i className="size-2 rounded-full border border-dashed" style={{ borderColor: HOME }} />
            {kWh(t.heading)} by midnight
          </span>
        )}
      </div>
    </div>
  );
}

const HOUR = 3600;

/** The hour of a lane's that holds `t`, by its index; -1 when none does. */
const hourIndex = (l: Lane, t: number) => l.t.findIndex((x) => x <= t && t < x + HOUR);

/** In the chart's tooltip: what each room used in the hour under the pointer, the most first. */
function LaneRows({ lanes, t }: { lanes: Lane[]; t: number }) {
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
 * Today hour by hour under the chart, on its time scale (zoomed with it): a lane each for the rooms, the car and
 * everything else, its name and total above it, each hour lit by how much of the lane's busiest hour it used. The hour
 * under the chart's pointer stands out in every lane, the rest fade back, and each lane says what it used in it.
 */
function Lanes({
  lanes,
  from,
  to,
  now,
  hover,
}: {
  lanes: Lane[];
  from: number;
  to: number;
  now: number;
  hover: number | null;
}) {
  const pc = (t: number) => ((Math.max(from, Math.min(to, t)) - from) / (to - from)) * 100;
  return (
    <div className="flex flex-col gap-2.5 border-t border-line-subtle pt-3">
      <span className="text-[11.5px] text-ink-faint">
        {hover != null
          ? `By room, ${hhmm(hover - (hover % HOUR))} to ${hhmm(hover - (hover % HOUR) + HOUR)}`
          : "By room, hour by hour, each lit by its own busiest hour"}
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
