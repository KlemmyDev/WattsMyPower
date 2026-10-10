import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useHasBattery } from "~/features/battery/hooks";
import { errorMessage } from "~/features/common/api/utils";
import { gridVerb, ON, reserveOf } from "~/features/common/energy/utils";
import { duration, hhmm } from "~/features/common/formatting/utils/date";
import { DASH, kW, kWh, money, pct } from "~/features/common/formatting/utils/number";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import { costsQuery, historyQuery } from "~/features/common/readings/api";
import type { HistorySeries } from "~/features/common/readings/types";
import { useSaveSettings } from "~/features/common/settings/hooks";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { useNow } from "~/features/common/time/hooks";
import { addDays, dateKey, midnight } from "~/features/common/time/utils";
import { ButtonLink, Button } from "~/features/common/ui/components/Button";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { TooltipRow } from "~/features/common/ui/components/ChartHover";
import { Select } from "~/features/common/ui/components/Field";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { SummaryCard, SummaryStat } from "~/features/common/ui/components/Summary";
import { useToast } from "~/features/common/ui/components/Toast";
import { cn } from "~/features/common/ui/utils";
import { gridQuery, refreshGrid } from "~/features/grid/api";
import { HazardsCard } from "~/features/grid/components/HazardsCard";
import { OutagesCard } from "~/features/grid/components/OutagesCard";
import { TimeLine, type LinePoint } from "~/features/common/ui/components/TimeLine";
import type { GridView, MarketNotice, OutlookReason } from "~/features/grid/types";
import { EXPORT, IMPORT, LEVEL, NOTICE_HELP, perMWh, REGIONS, wholesaleCents } from "~/features/grid/utils";

const FIELDS = ["grid_power", "grid_voltage", "grid_freq"];

/**
 * The grid: whether it's holding up (and what to do if it isn't) first, then what the house is buying and selling now
 * and through the day, what power costs wholesale in the region (AEMO), the grid's voltage and frequency at the house,
 * and AEMO's notices for the region.
 */
export function GridPage() {
  const now = useNow(30_000);
  const p = useSnapshot();
  const s = useSystem();
  const { data: grid, isError } = useQuery(gridQuery);
  const start = midnight(now);
  const { data: day } = useQuery(
    historyQuery({ start, end: addDays(start, 1), points: 288, fields: FIELDS, live: true }),
  );
  const series = day?.series;
  return (
    <>
      <PageHeader title="Grid" sub="What you buy and sell, what power costs right now, and how the grid's holding up" />
      <div className="flex flex-col gap-5">
        <GridSummary grid={grid} p={p} s={s} now={now} />
        {grid?.outages && (
          <OutagesCard
            view={grid.outages}
            now={now}
            home={s?.latitude != null && s.longitude != null ? { lat: s.latitude, lon: s.longitude } : null}
          />
        )}
        <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1">
          <div className="flex min-w-0 flex-col gap-5">
            <TodayCard series={series} p={p} start={start} now={now} />
            {grid ? <WholesaleCard grid={grid} now={now} /> : <Skeleton className="h-[300px] rounded-3xl" />}
          </div>
          <div className="flex min-w-0 flex-col gap-5">
            {grid?.hazards && <HazardsCard view={grid.hazards} now={now} />}
            <QualityCard series={series} p={p} grid={grid} start={start} now={now} />
            {grid && <NoticesCard grid={grid} />}
          </div>
        </div>
        {isError && !grid && (
          <div className="text-sm text-ink-faint">The grid's figures could not be loaded. Try again shortly.</div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- the summary

/** The outlook's level in a word, as the summary's first figure. */
const STATUS: Record<GridView["outlook"]["level"], string> = {
  normal: "Normal",
  watch: "Worth knowing",
  warning: "Blackout risk",
  outage: "Down",
};

/**
 * The grid in one card, as the Solar and Home pages have theirs: how it's holding up (in a word, its colour and icon),
 * then the house's power to or from it now, what it bought and sold today, and the wholesale price now. When it's not
 * normal, what to do and why under them: how long the battery would last, a way to top it up from the grid while it's
 * there, and each reason.
 */
function GridSummary({
  grid,
  p,
  s,
  now,
}: {
  grid: GridView | undefined;
  p: Snapshot | null;
  s: SystemInfo | undefined;
  now: number;
}) {
  const level = grid?.outlook.level;
  const l = level ? LEVEL[level] : null;
  const g = p?.grid_power;
  const market = grid?.market;
  // Today's cost of what was bought and credit for what was sold, at your rates (the Home page asks for the same).
  const today = useQuery(costsQuery(midnight(now))).data?.days.find((d) => d.date === dateKey(now));
  const steady = grid
    ? grid.enabled
      ? "No warnings from AEMO, no storms forecast, and the grid's steady at your house."
      : grid.location_set
        ? "The grid's steady at your house. Choose your region below for AEMO's warnings too."
        : "The grid's steady at your house. Set your location, or choose your region below, for AEMO's warnings too."
    : undefined;
  return (
    <SummaryCard
      icon={!level ? "grid" : level === "normal" ? "check" : level === "outage" ? "bolt" : "shield"}
      color={l?.color ?? COLOR.gridSoft}
      footer={grid && level !== "normal" && <Warnings grid={grid} p={p} s={s} />}
    >
      <SummaryStat
        label="Grid"
        value={level ? STATUS[level] : DASH}
        color={level && level !== "normal" ? l?.color : undefined}
        sub={grid ? (grid.region_name ?? "Your house") : "Checking"}
        title={level === "normal" ? steady : l?.sub}
      />
      <SummaryStat
        label={gridVerb(g)}
        dot={g == null ? undefined : g > ON ? IMPORT : g < -ON ? EXPORT : undefined}
        value={g == null ? DASH : kW(Math.abs(g))}
        sub={
          g != null && Math.abs(g) <= ON ? "Nothing in or out" : g != null && g > ON ? "From the grid" : "To the grid"
        }
      />
      <SummaryStat
        label="Bought today"
        dot={IMPORT}
        value={kWh(p?.daily_import)}
        sub={today ? `${money(today.import_cost)} at your rates` : "From the grid"}
      />
      <SummaryStat
        label="Sold today"
        dot={EXPORT}
        value={kWh(p?.daily_export)}
        sub={today ? `${money(today.feed_in_credit)} earned` : "To the grid"}
      />
      <SummaryStat
        label="Wholesale now"
        value={market ? `${wholesaleCents(market.price)}/kWh` : DASH}
        sub={
          market
            ? `${perMWh(market.price)} · ${grid?.region_name}`
            : grid && !grid.enabled
              ? grid.region_auto && !grid.location_set
                ? "Needs your location"
                : "Not following AEMO"
              : "Waiting for AEMO"
        }
      />
    </SummaryCard>
  );
}

/**
 * Under the summary when the grid's not normal: what it means, the battery (how long it would last at this use, and a
 * way to charge it from the grid while there's still grid, when it's worth it), and each reason.
 */
function Warnings({ grid, p, s }: { grid: GridView; p: Snapshot | null; s: SystemInfo | undefined }) {
  const { level, reasons } = grid.outlook;
  const l = LEVEL[level];
  const hasBattery = useHasBattery();
  const soc = p?.battery_soc;
  const cap = s?.battery_kwh;
  const load = p?.load_power;
  // What's left above the reserve, at what the house is using now.
  const left =
    soc != null && cap && load && load > ON ? ((Math.max(0, soc - reserveOf(s)) / 100) * cap * 1000) / load : null;
  const worried = level === "warning" || reasons.some((r) => r.kind === "storm");
  return (
    <div className="flex flex-col gap-4 border-t border-line-subtle pt-4">
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <div className="text-[13.5px] leading-5 text-pretty text-ink-muted">{l.sub}</div>
        {hasBattery && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-col items-end text-right text-[13px] leading-5 tabular-nums max-sm:items-start max-sm:text-left">
              <span className="font-medium text-ink">Battery {pct(soc)}</span>
              {left != null && <span className="text-ink-faint">About {duration(left * 3600)} at this use</span>}
            </div>
            {worried && soc != null && soc < 95 && (
              <ButtonLink to="/battery" variant="primary" size="sm">
                Charge from the grid
              </ButtonLink>
            )}
          </div>
        )}
      </div>
      {reasons.length > 0 && (
        <ul className="flex flex-col gap-2">
          {reasons.map((r, i) => (
            <Reason key={`${r.kind}${i}`} r={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Reason({ r }: { r: OutlookReason }) {
  return (
    <li className="flex items-baseline gap-2.5 text-[13.5px] leading-5">
      <span
        aria-hidden
        className="size-2 flex-none translate-y-[-1px] rounded-full"
        style={{ background: LEVEL[r.level].color }}
      />
      <span className="min-w-0">
        <span className="font-medium text-ink">{r.title}</span>
        <span className="text-ink-muted"> · {r.detail}</span>
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------------------------- today

function points(series: HistorySeries | undefined, field: string): LinePoint[] {
  if (!series) return [];
  const vs = series[field] ?? [];
  return series.t.map((t, i) => ({ t, v: vs[i] ?? null }));
}

/** Power to and from the grid through today: from it above the line, to it below. */
function TodayCard({
  series,
  p,
  start,
  now,
}: {
  series: HistorySeries | undefined;
  p: Snapshot | null;
  start: number;
  now: number;
}) {
  const pts = points(series, "grid_power");
  const peak = pts.reduce<LinePoint | null>((a, b) => (b.v != null && (!a || b.v > (a.v ?? 0)) ? b : a), null);
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TitleBlock
          title="Today"
          sub={
            peak?.v != null && peak.v > ON
              ? `Drew the most from the grid at ${hhmm(peak.t)}: ${kW(peak.v)}`
              : "Power from the grid and sent to it, through the day"
          }
        />
        <div className="flex gap-4 text-xs text-ink-dim">
          <span className="flex items-center gap-1.5">
            <i className="size-2 rounded-xs" style={{ background: IMPORT }} />
            From the grid {kWh(p?.daily_import)}
          </span>
          <span className="flex items-center gap-1.5">
            <i className="size-2 rounded-xs" style={{ background: EXPORT }} />
            To the grid {kWh(p?.daily_export)}
          </span>
        </div>
      </div>
      {series ? (
        <TimeLine
          points={pts}
          start={start}
          end={addDays(start, 1)}
          now={now}
          color={IMPORT}
          height={180}
          signed={{ above: IMPORT, below: EXPORT }}
          empty="No readings today yet."
          tip={(pt) => (
            <>
              <span className="font-medium text-ink">{hhmm(pt.t)}</span>
              <TooltipRow
                label={(pt.v ?? 0) > ON ? "From the grid" : (pt.v ?? 0) < -ON ? "To the grid" : "Grid"}
                value={Math.abs(pt.v ?? 0) > ON ? kW(pt.v) : "Idle"}
                color={(pt.v ?? 0) > ON ? IMPORT : (pt.v ?? 0) < -ON ? EXPORT : undefined}
              />
            </>
          )}
        />
      ) : (
        <Skeleton className="h-[200px] rounded-2xl" />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------- wholesale

/**
 * The region's wholesale price from AEMO through today and ahead to the early hours (pre-dispatch, dashed), in cents a
 * kWh, with where a spike starts marked when prices get near it. The region can be changed, or AEMO not followed.
 */
function WholesaleCard({ grid, now }: { grid: GridView; now: number }) {
  const save = useSaveSettings();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const start = midnight(now);
  const last = grid.prices.length ? grid.prices[grid.prices.length - 1].at : addDays(start, 1);
  const end = Math.max(addDays(start, 1), last);
  const pts: LinePoint[] = grid.prices.map((x) => ({
    t: x.at,
    v: x.price == null ? null : x.price / 10,
    forecast: x.forecast,
  }));
  const today = pts.filter((x) => x.t >= start && x.v != null);
  const top = Math.max(...today.map((x) => x.v ?? 0));
  const spike = grid.limits.spike / 10;
  const choose = (value: string) => {
    save.mutate({ nem_region: value as never }, { onError: (e) => toast(errorMessage(e)) });
  };
  const retry = async () => {
    setBusy(true);
    try {
      qc.setQueryData(gridQuery.queryKey, await refreshGrid());
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  // Automatic, without a location yet, works out no region: it's still what's chosen.
  const waiting = grid.region_auto && !grid.location_set;
  const chosen = grid.enabled ? (grid.region_auto ? "auto" : grid.region!) : waiting ? "auto" : "none";
  const autoName =
    grid.region_auto && grid.region_name
      ? `Automatic (${grid.region_name})`
      : waiting
        ? "Automatic (needs your location)"
        : "Automatic";
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TitleBlock
          title="Wholesale price"
          sub={
            grid.enabled
              ? `What power sells for in ${grid.region_name ?? "your region"} before network charges and your retailer's margin, from AEMO every five minutes. Most bills don't follow it; Amber's does.`
              : "Follow your region's wholesale price, and AEMO's warnings of tight supply and load shedding."
          }
        />
        <Select
          aria-label="Region"
          value={chosen}
          onChange={(e) => choose(e.target.value)}
          disabled={save.isPending}
          className="h-9 text-sm"
        >
          <option value="auto">{autoName}</option>
          {REGIONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
          <option value="none">Don't follow AEMO</option>
        </Select>
      </div>
      {grid.error && (
        <Notice tone="warn" className="flex flex-wrap items-center justify-between gap-2">
          {grid.error}
          <Button variant="link" size="sm" onClick={retry} disabled={busy}>
            {busy ? "Trying…" : "Try again"}
          </Button>
        </Notice>
      )}
      {grid.enabled && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-ink-dim">
            <span className="flex flex-wrap gap-x-4 gap-y-1">
              <span className="flex items-center gap-1.5">
                <i className="h-[3px] w-3.5 rounded-[2px]" style={{ background: COLOR.lilac }} />
                Wholesale, c/kWh
              </span>
              <span className="flex items-center gap-1.5">
                <i className="w-3.5 border-t-2 border-dashed border-ink-muted" />
                AEMO's forecast
              </span>
            </span>
            {today.length > 0 && <span className="tabular-nums">Today up to {wholesaleCents(top * 10)}</span>}
          </div>
          <TimeLine
            points={pts}
            start={start}
            end={end}
            now={now}
            color={COLOR.lilac}
            marks={top >= spike * 0.6 ? [{ v: spike, label: "Spike", color: alpha(COLOR.warn, 0.7) }] : []}
            empty={grid.error ? "No prices yet." : "Waiting for AEMO's prices."}
            tip={(pt) => (
              <>
                <span className="flex items-center justify-between font-medium text-ink">
                  {pt.forecast ? `${hhmm(pt.t - 1800)} to ${hhmm(pt.t)}` : hhmm(pt.t)}
                  {pt.forecast && <span className="text-[11px] font-normal text-ink-faint">Forecast</span>}
                </span>
                <TooltipRow label="Wholesale" value={`${wholesaleCents((pt.v ?? 0) * 10)}/kWh`} color={COLOR.lilac} />
                <TooltipRow label="Per MWh" value={perMWh((pt.v ?? 0) * 10)} />
              </>
            )}
          />
          {grid.market?.demand != null && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-faint">
              <span>
                {grid.region_name} is using {(grid.market.demand / 1000).toFixed(1)} GW
              </span>
              {grid.fetched_at && <span>Updated {hhmm(grid.fetched_at)}</span>}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------- quality

function stats(pts: LinePoint[]) {
  const vs = pts.map((x) => x.v).filter((v): v is number => v != null && v > 0);
  if (!vs.length) return null;
  return { min: Math.min(...vs), max: Math.max(...vs) };
}

/**
 * The grid at the house, as the inverter measures it: its voltage through today against the range the standard allows
 * (high voltage makes the inverter hold back exports), and its frequency.
 */
function QualityCard({
  series,
  p,
  grid,
  start,
  now,
}: {
  series: HistorySeries | undefined;
  p: Snapshot | null;
  grid: GridView | undefined;
  start: number;
  now: number;
}) {
  const volts = points(series, "grid_voltage").map((x) => ({ ...x, v: x.v != null && x.v > 50 ? x.v : null }));
  const hz = points(series, "grid_freq");
  const vs = stats(volts);
  const fs = stats(hz);
  const lim = grid?.limits ?? { voltage_low: 216, voltage_high: 253, freq_low: 49.85, freq_high: 50.15, spike: 300 };
  const step = series && series.t.length > 1 ? series.t[1] - series.t[0] : 300;
  const high = volts.filter((x) => x.v != null && x.v > lim.voltage_high).length * step;
  const v = p?.grid_voltage;
  const f = p?.grid_freq;
  const noVoltage = series && !vs && v == null;
  return (
    <Card>
      <TitleBlock
        title="Grid quality"
        sub={
          high > 0
            ? `Above ${lim.voltage_high} V for ${duration(high)} today: your inverter may have held back exports.`
            : "The grid's voltage and frequency at your house"
        }
      />
      <div className="grid grid-cols-2 gap-3">
        <Reading
          label="Voltage"
          value={v != null && v > 50 ? `${v.toFixed(0)} V` : DASH}
          sub={vs ? `${vs.min.toFixed(0)} to ${vs.max.toFixed(0)} V today` : undefined}
          bad={v != null && v > 50 && (v > lim.voltage_high || v < lim.voltage_low)}
        />
        <Reading
          label="Frequency"
          value={f != null && f > 0 ? `${f.toFixed(2)} Hz` : DASH}
          sub={fs ? `${fs.min.toFixed(2)} to ${fs.max.toFixed(2)} Hz today` : undefined}
          bad={f != null && f > 0 && (f > lim.freq_high || f < lim.freq_low)}
        />
      </div>
      {noVoltage ? (
        <div className="text-[13px] text-ink-faint">Your inverter doesn't report the grid's voltage.</div>
      ) : series ? (
        <TimeLine
          points={volts}
          start={start}
          end={addDays(start, 1)}
          now={now}
          color={COLOR.teal}
          height={130}
          domain={[lim.voltage_low - 4, lim.voltage_high + 4]}
          band={{ from: lim.voltage_low, to: lim.voltage_high, label: `${lim.voltage_low} to ${lim.voltage_high} V` }}
          empty="No voltage readings today yet."
          tip={(pt) => (
            <>
              <span className="font-medium text-ink">{hhmm(pt.t)}</span>
              <TooltipRow label="Voltage" value={`${(pt.v ?? 0).toFixed(1)} V`} color={COLOR.teal} />
            </>
          )}
        />
      ) : (
        <Skeleton className="h-[150px] rounded-2xl" />
      )}
    </Card>
  );
}

function Reading({ label, value, sub, bad }: { label: string; value: string; sub?: string; bad?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-2xl bg-fg/4 px-4 py-3">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className={cn("text-xl font-light tabular-nums", bad ? "text-warn" : "text-ink")}>{value}</span>
      {sub && <span className="text-[11.5px] text-ink-faint tabular-nums">{sub}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- notices

/** AEMO's notices about the region over the last two days that matter to a household, current ones first. */
function NoticesCard({ grid }: { grid: GridView }) {
  if (!grid.enabled) return null;
  const list = [...grid.notices].sort((a, b) => Number(b.active) - Number(a.active) || b.at - a.at);
  return (
    <Card>
      <TitleBlock
        title="AEMO notices"
        sub={`Warnings from the market operator about ${grid.region_name ?? "your region"}, from the last two days`}
      />
      {list.length ? (
        <ul className="-my-1 flex flex-col">
          {list.map((n) => (
            <NoticeRow key={n.id} n={n} />
          ))}
        </ul>
      ) : (
        <div className="text-[13px] text-ink-faint">
          None: no tight supply, load shedding or system events in your region.
        </div>
      )}
    </Card>
  );
}

function NoticeRow({ n }: { n: MarketNotice }) {
  const [open, setOpen] = useState(false);
  const color =
    !n.active || n.level === "info" ? alpha(COLOR.fg, 0.25) : n.level === "critical" ? COLOR.danger : COLOR.warn;
  const when = new Date(n.at * 1000).toLocaleString("en-AU", { weekday: "short", hour: "numeric", minute: "2-digit" });
  return (
    <li className="border-b border-line-subtle py-1 last:border-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="group -mx-2 flex w-[calc(100%+1rem)] cursor-pointer items-start gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-fg/4"
      >
        <span aria-hidden className="mt-1.5 size-2 flex-none rounded-full" style={{ background: color }} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn("text-[13.5px] leading-5", n.active ? "text-ink" : "text-ink-muted")}>{n.title}</span>
          <span className="text-xs text-ink-faint">
            {when}
            {!n.active && (n.cancels ? " · Cancelled" : " · Over")}
          </span>
        </span>
        <Icon
          name="chevD"
          size={14}
          className={cn(
            "mt-1 flex-none text-ink-faint transition-[transform,color] group-hover:text-ink",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="flex flex-col gap-2 pt-1 pb-1.5 pl-[18px] text-[12.5px] leading-[18px] text-ink-muted">
          <span className="text-ink-soft">{NOTICE_HELP[n.kind]}</span>
          <pre className="max-h-64 overflow-auto font-sans whitespace-pre-wrap">{n.body}</pre>
        </div>
      )}
    </li>
  );
}
