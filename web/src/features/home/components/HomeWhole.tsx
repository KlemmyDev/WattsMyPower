import { useQuery } from "@tanstack/react-query";
import type { CSSProperties, ReactNode } from "react";
import { energyToday, ON } from "~/features/common/energy/utils";
import { hhmm, parseYmd, shortDay } from "~/features/common/formatting/utils/date";
import { DASH, kW, kWh, money, pct, powerParts } from "~/features/common/formatting/utils/number";
import type { Snapshot } from "~/features/common/live/types";
import { costsQuery } from "~/features/common/readings/api";
import type { HistorySeries } from "~/features/common/readings/types";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, dateKey, midnight } from "~/features/common/time/utils";
import { Breakdown } from "~/features/common/ui/components/Breakdown";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { ChartTooltip, TooltipRow, useBarHover } from "~/features/common/ui/components/ChartHover";
import { Icon } from "~/features/common/ui/components/Icon";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { TimeLine, type LinePoint } from "~/features/common/ui/components/TimeLine";
import { cn } from "~/features/common/ui/utils";
import type { Forecast } from "~/features/common/weather/types";
import { dailyQuery } from "~/features/history/api";
import { buildDays, hasData, type DataDay } from "~/features/history/utils/year";

const HOME = COLOR.teal;
const USUAL = alpha(COLOR.fg, 0.45);
// Where the house's power came from, as History has it.
const SOURCES = { solar: COLOR.solar, battery: COLOR.battery, grid: COLOR.bar } as const;

/** What the house usually uses by `t` today (kWh), from the forecast's typical day (kW by the hour). */
function usualBy(profile: number[] | undefined, t: number): number | null {
  if (profile?.length !== 24) return null;
  const start = midnight(t);
  let kwh = 0;
  for (let h = 0; h < 24; h++) {
    const from = start + h * 3600;
    if (from >= t) break;
    kwh += (profile[h] * (Math.min(t, from + 3600) - from)) / 3600;
  }
  return kwh;
}

/** Each 5 minutes' home use split by where it came from: solar first, then the battery, then the grid. */
function sourcesOf(series: HistorySeries | undefined) {
  const out = { solar: 0, battery: 0, grid: 0 };
  if (!series) return out;
  const t = series.t;
  for (let i = 0; i < t.length; i++) {
    const load = series.load_power?.[i];
    if (load == null || load <= 0) continue;
    const step = ((t[i + 1] ?? t[i] + 300) - t[i]) / 3600;
    const solar = Math.min(load, Math.max(0, series.pv_power?.[i] ?? 0));
    const battery = Math.min(load - solar, Math.max(0, series.battery_power?.[i] ?? 0));
    out.solar += (solar / 1000) * step;
    out.battery += (battery / 1000) * step;
    out.grid += (Math.max(0, load - solar - battery) / 1000) * step;
  }
  return out;
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[13px] text-ink-muted">{label}</span>
      <span className="text-[22px] leading-7 font-light tracking-[-0.4px] text-ink tabular-nums">{value}</span>
      {sub && <span className="truncate text-xs text-ink-faint">{sub}</span>}
    </div>
  );
}

/**
 * The whole house, from the inverter (no plugs needed): what it's using now and where that's coming from, today so far
 * against a usual day by now, where it should end up by midnight, today's peak, and what today's grid power has cost.
 */
export function HomeNow({
  p,
  f,
  series,
  now,
}: {
  p: Snapshot | null;
  f: Forecast | null | undefined;
  series: HistorySeries | undefined;
  now: number;
}) {
  const load = p?.load_power;
  const [value, unit] = load == null ? [DASH, ""] : powerParts(Math.max(0, load));
  const pv = Math.max(0, p?.pv_power ?? 0);
  const bat = Math.max(0, p?.battery_power ?? 0);
  const L = Math.max(0, load ?? 0);
  const fromSolar = Math.min(L, pv);
  const fromBattery = Math.min(L - fromSolar, bat);
  const fromGrid = Math.max(0, L - fromSolar - fromBattery);
  const now3 = [
    { key: "solar", label: "solar", w: fromSolar },
    { key: "battery", label: "the battery", w: fromBattery },
    { key: "grid", label: "the grid", w: fromGrid },
  ].filter((x) => x.w > ON);
  const sofar = energyToday(p)?.home ?? null;
  const usual = usualBy(f?.load_basis?.profile_kw, now);
  const rest = f?.days.find((d) => d.date === dateKey(now))?.load_kwh;
  const peak = (() => {
    const t = series?.t ?? [];
    const v = series?.load_power ?? [];
    let at = -1;
    for (let i = 0; i < t.length; i++) if (v[i] != null && (at < 0 || v[i]! > v[at]!)) at = i;
    return at >= 0 ? { t: t[at], w: v[at]! } : null;
  })();
  const { data: costs } = useQuery(costsQuery(midnight(now)));
  const today = costs?.days.find((d) => d.date === dateKey(now));
  const diff = sofar != null && usual ? sofar / usual - 1 : null;
  return (
    <section
      className="col-span-12 flex flex-wrap items-center gap-x-10 gap-y-6 overflow-hidden rounded-3xl border border-line-subtle bg-surface p-7 max-sm:rounded-[20px] max-sm:p-5"
      style={{ backgroundImage: `linear-gradient(110deg, ${alpha(HOME, 0.1)}, transparent 55%)` }}
    >
      <div className="flex items-center gap-5">
        <span
          className="flex size-14 flex-none items-center justify-center rounded-[18px]"
          style={{ background: alpha(HOME, 0.16), color: HOME }}
        >
          <Icon name="home" size={26} />
        </span>
        <div className="flex flex-col">
          <span className="flex items-baseline gap-1.5 text-[52px] leading-[56px] font-light tracking-[-2px] tabular-nums max-sm:text-[42px] max-sm:leading-[48px]">
            {value}
            <span className="text-lg font-normal tracking-normal text-ink-faint">{unit}</span>
          </span>
          <span className="flex flex-wrap items-center gap-x-2.5 text-[13px] text-ink-muted">
            {now3.length ? (
              <>
                From
                {now3.map((x, i) => (
                  <span key={x.key} className="flex items-center gap-1.5">
                    <i
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ background: SOURCES[x.key as keyof typeof SOURCES] }}
                    />
                    {x.label}
                    {now3.length > 1 && <span className="text-ink-faint tabular-nums">{kW(x.w)}</span>}
                    {i < now3.length - 1 && <span className="text-ink-faint">·</span>}
                  </span>
                ))}
              </>
            ) : (
              "The house is using next to nothing"
            )}
          </span>
        </div>
      </div>
      <div className="grid min-w-[min(100%,26rem)] flex-1 grid-cols-4 gap-x-6 gap-y-4 max-lg:grid-cols-2">
        <Stat
          label="Today so far"
          value={kWh(sofar)}
          sub={
            diff == null
              ? undefined
              : Math.abs(diff) < 0.05
                ? "About usual"
                : `${pct(Math.abs(diff) * 100)} ${diff > 0 ? "over" : "under"} usual`
          }
        />
        <Stat
          label="By midnight"
          value={sofar != null && rest != null ? kWh(sofar + rest) : DASH}
          sub="At a usual pace"
        />
        <Stat label="Peak today" value={peak ? kW(peak.w) : DASH} sub={peak ? `At ${hhmm(peak.t)}` : undefined} />
        <Stat
          label="Grid power today"
          value={today ? money(today.import_cost) : DASH}
          sub={today && today.saved > 0 ? `${money(today.saved)} saved` : undefined}
        />
      </div>
    </section>
  );
}

/** Today's home use through the day, against a usual day's (the forecast's typical day, dashed). */
export function HomeTodayCard({
  series,
  f,
  start,
  now,
}: {
  series: HistorySeries | undefined;
  f: Forecast | null | undefined;
  start: number;
  now: number;
}) {
  const actual: LinePoint[] = series ? series.t.map((t, i) => ({ t, v: series.load_power?.[i] ?? null })) : [];
  const profile = f?.load_basis?.profile_kw;
  const usual: LinePoint[] =
    profile?.length === 24 ? profile.map((kw, h) => ({ t: start + h * 3600 + 1800, v: kw * 1000 })) : [];
  return (
    <Card className="col-span-7 max-xl:col-span-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TitleBlock
          title="Today against a usual day"
          sub={
            f?.load_basis
              ? `The usual day is the last ${f.load_basis.window_days} days' home use, hour by hour`
              : "Home use through the day"
          }
        />
        <div className="flex gap-4 text-xs text-ink-dim">
          <span className="flex items-center gap-1.5">
            <i className="h-[3px] w-3.5 rounded-[2px]" style={{ background: HOME }} />
            Today
          </span>
          {usual.length > 0 && (
            <span className="flex items-center gap-1.5">
              <i className="w-3.5 border-t-2 border-dashed" style={{ borderColor: USUAL }} />
              Usual
            </span>
          )}
        </div>
      </div>
      {series ? (
        <TimeLine
          points={actual}
          compare={usual.length ? { points: usual, color: USUAL } : undefined}
          start={start}
          end={addDays(start, 1)}
          now={now}
          color={HOME}
          fill
          height={190}
          domain={[0, 1000]}
          every={3}
          empty="No readings today yet."
          tip={(pt, other) => (
            <>
              <span className="font-medium text-ink">{hhmm(pt.t)}</span>
              {pt.v != null && <TooltipRow label="Today" value={kW(pt.v)} color={HOME} />}
              {other?.v != null && <TooltipRow label="Usual" value={kW(other.v)} color={USUAL} />}
            </>
          )}
        />
      ) : (
        <Skeleton className="h-[210px] rounded-2xl" />
      )}
    </Card>
  );
}

/**
 * Where the house's power came from today (solar straight from the panels, the battery, the grid), and how much of it
 * the house made itself today and over the last 30 days.
 */
export function HomeSourcesCard({
  series,
  p,
  days,
}: {
  series: HistorySeries | undefined;
  p: Snapshot | null;
  days: DataDay[];
}) {
  const s = sourcesOf(series);
  const home = energyToday(p)?.home ?? s.solar + s.battery + s.grid;
  const sum = s.solar + s.battery + s.grid;
  // The split is from the readings; the total is what the counters say.
  const k = sum > 0 ? home / sum : 0;
  const parts = [
    { key: "solar", label: "Solar, straight from the panels", kwh: s.solar * k, color: SOURCES.solar },
    { key: "battery", label: "The battery", kwh: s.battery * k, color: SOURCES.battery },
    { key: "grid", label: "The grid", kwh: s.grid * k, color: SOURCES.grid },
  ];
  const self = home > 0 ? 1 - (s.grid * k) / home : null;
  const whole = days.filter((d) => !d.partial);
  const month = whole.length
    ? whole.reduce((a, d) => a + d.home * d.ss, 0) /
      Math.max(
        0.01,
        whole.reduce((a, d) => a + d.home, 0),
      )
    : null;
  return (
    <Card className="col-span-5 max-xl:col-span-12">
      <div className="flex items-end justify-between gap-3">
        <TitleBlock className="min-w-0 flex-1" title="Where it came from" sub="Today's home use so far" />
        {self != null && (
          <div className="flex flex-none flex-col items-end gap-0.5">
            <span className="text-xs text-ink-faint">Self-powered</span>
            <span className="text-[28px] leading-8 font-light tracking-[-1px] tabular-nums">{pct(self * 100)}</span>
          </div>
        )}
      </div>
      {home > 0 ? (
        <Breakdown parts={parts} total={home} />
      ) : (
        <div className="text-[13px] text-ink-faint">No home use recorded yet today.</div>
      )}
      {month != null && (
        <div className="text-xs text-ink-faint">
          {pct(month * 100)} self-powered over the last {whole.length} {whole.length === 1 ? "day" : "days"}.
        </div>
      )}
    </Card>
  );
}

/**
 * The last 30 days of home use, each day stacked by where it came from, with the usual weekday and weekend day, and
 * the biggest day.
 */
export function HomeDaysCard({ days }: { days: DataDay[] }) {
  const whole = days.filter((d) => !d.partial);
  const { hover: h, width, plot, bar } = useBarHover();
  if (!whole.length) return null;
  const top = Math.max(1, ...whole.map((d) => d.home)) * 1.05;
  const avg = (list: DataDay[]) => (list.length ? list.reduce((a, d) => a + d.home, 0) / list.length : null);
  const weekend = (d: DataDay) => [0, 6].includes(new Date(d.ts * 1000).getDay());
  const weekdays = avg(whole.filter((d) => !weekend(d)));
  const weekends = avg(whole.filter(weekend));
  const biggest = whole.reduce((a, d) => (d.home > a.home ? d : a), whole[0]);
  return (
    <Card className="col-span-12">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <TitleBlock
          className="min-w-0 flex-1"
          title={`Last ${whole.length} days`}
          sub={`${kWh(avg(whole))} a day. The biggest was ${shortDay.format(parseYmd(biggest.key))}, ${kWh(biggest.home)}`}
        />
        <div className="flex gap-6">
          {[
            ["A weekday", weekdays],
            ["A weekend day", weekends],
          ].map(([label, v]) => (
            <div key={label as string} className="flex flex-col items-end gap-0.5">
              <span className="text-xs text-ink-faint">{label}</span>
              <span className="text-[22px] leading-7 font-light tabular-nums">
                {v != null ? kWh(v as number) : DASH}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="relative flex h-32 items-end gap-1 max-sm:gap-0.5" {...plot}>
          {whole.map((d, i) => (
            // The day's column, the full height of the chart, so a small day is as easy to point at as a big one.
            <button
              key={d.key}
              type="button"
              {...bar(i)}
              aria-label={`${shortDay.format(parseYmd(d.key))}: ${kWh(d.home)} (solar ${kWh(d.direct)}, battery ${kWh(d.battery)}, grid ${kWh(d.imp)})`}
              className={cn(
                "flex h-full min-w-0 flex-1 cursor-default items-end border-0 bg-transparent p-0 transition-opacity duration-200",
                h != null && h !== i && "opacity-45",
              )}
            >
              <span
                className="bar-grow flex w-full flex-col-reverse overflow-hidden rounded-[4px_4px_2px_2px]"
                style={{ height: `${(d.home / top) * 100}%`, "--i": i } as CSSProperties}
              >
                {[
                  [d.direct, SOURCES.solar],
                  [d.battery, SOURCES.battery],
                  [Math.max(0, d.home - d.direct - d.battery), SOURCES.grid],
                ].map(([v, c], k) => (
                  <i
                    key={k}
                    className="block w-full flex-none"
                    style={{ height: `${d.home ? ((v as number) / d.home) * 100 : 0}%`, background: c as string }}
                  />
                ))}
              </span>
            </button>
          ))}
          {h != null && (
            <ChartTooltip left={((h + 0.5) / whole.length) * 100} flip={h > whole.length / 2} width={width}>
              <span className="font-medium text-ink">{shortDay.format(parseYmd(whole[h].key))}</span>
              <TooltipRow label="Solar" value={kWh(whole[h].direct)} color={SOURCES.solar} />
              <TooltipRow label="Battery" value={kWh(whole[h].battery)} color={SOURCES.battery} />
              <TooltipRow
                label="Grid"
                value={kWh(Math.max(0, whole[h].home - whole[h].direct - whole[h].battery))}
                color={SOURCES.grid}
              />
              <TooltipRow label="Home used" value={kWh(whole[h].home)} />
              <TooltipRow label="Self-powered" value={pct(whole[h].ss * 100)} />
            </ChartTooltip>
          )}
        </div>
        <div className="flex justify-between font-mono text-[11px] text-ink-faint">
          {[whole[0], whole[whole.length - 1]].map((d) => (
            <span key={d.key}>{shortDay.format(parseYmd(d.key))}</span>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-ink-dim">
        {(
          [
            ["Solar", SOURCES.solar],
            ["Battery", SOURCES.battery],
            ["Grid", SOURCES.grid],
          ] as const
        ).map(([label, c]) => (
          <span key={label} className="flex items-center gap-1.5">
            <i className="size-2 rounded-xs" style={{ background: c }} />
            {label}
          </span>
        ))}
      </div>
    </Card>
  );
}

/** The last 30 days with readings (today included, still filling in), for the cards above. */
export function useHomeDays(now: number): DataDay[] {
  const today = midnight(now);
  const start = addDays(today, -30);
  const { data } = useQuery(dailyQuery(start, addDays(today, 1)));
  return buildDays(start, addDays(today, 1), today, data, data ? [] : undefined).filter(hasData);
}
