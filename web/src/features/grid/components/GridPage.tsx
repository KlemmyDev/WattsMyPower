import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { duration, hhmm, weekdayShort } from "~/features/common/formatting/utils/date";
import { DASH } from "~/features/common/formatting/utils/number";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import type { Snapshot } from "~/features/common/live/types";
import type { HistorySeries } from "~/features/common/readings/types";
import { useSaveSettings } from "~/features/common/settings/hooks";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, midnight } from "~/features/common/time/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { TooltipRow } from "~/features/common/ui/components/ChartHover";
import { Select } from "~/features/common/ui/components/Field";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { useToast } from "~/features/common/ui/components/Toast";
import { TimeLine, type LinePoint } from "~/features/common/ui/components/TimeLine";
import { cn } from "~/features/common/ui/utils";
import { useLiveDay, useLiveHero } from "~/features/live/hooks";
import { gridQuery, refreshGrid } from "~/features/grid/api";
import { Warnings } from "~/features/grid/components/GridHero";
import { useGridHero } from "~/features/grid/components/GridSky";
import { HazardsCard } from "~/features/grid/components/HazardsCard";
import { OutagesCard } from "~/features/grid/components/OutagesCard";
import { useGridDay } from "~/features/grid/hooks";
import type { GridView, MarketNotice } from "~/features/grid/types";
import { NOTICE_HELP, perMWh, REGIONS, wholesaleCents } from "~/features/grid/utils";

/**
 * The grid. Its top card is the one the live pages share (its part is useGridHero): the street and the line to your
 * meter in the sky, what you've spent or earned today, what's flowing now and at what price, and the day's chart with
 * the price under it. Under it, when the grid isn't normal, what to do and why; then outages around the house and the
 * grid's voltage there on the left, and weather and fire warnings and the wholesale market with AEMO's notices on the
 * right.
 */
export function GridPage() {
  const { now } = useLiveDay();
  const p = useSnapshot();
  const s = useSystem();
  const { data: grid, isError } = useQuery(gridQuery);
  const { start, series } = useGridDay(now);
  useLiveHero(useGridHero({ grid, p, s, series }));
  return (
    <>
      {grid && grid.outlook.level !== "normal" && (
        <Card>
          <Warnings grid={grid} p={p} s={s} />
        </Card>
      )}
      {/* Outages and the voltage on the left; warnings and the market on the right. Narrower, one column: outages,
            then warnings, then the rest. */}
      <div className="live-cols grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-5 max-3xl:contents">
          {grid?.outages && (
            <OutagesCard
              view={grid.outages}
              now={now}
              home={s?.latitude != null && s.longitude != null ? { lat: s.latitude, lon: s.longitude } : null}
              className="max-3xl:order-1"
            />
          )}
          <QualityCard series={series} p={p} grid={grid} start={start} now={now} className="max-3xl:order-4" />
        </div>
        <div className="flex min-w-0 flex-col gap-5 max-3xl:contents">
          {grid?.hazards && <HazardsCard view={grid.hazards} now={now} className="max-3xl:order-2" />}
          {grid ? (
            <MarketCard grid={grid} now={now} className="max-3xl:order-3" />
          ) : (
            <Skeleton className="h-[360px] rounded-3xl max-3xl:order-3" />
          )}
        </div>
      </div>
      {isError && !grid && (
        <div className="text-sm text-ink-faint">Couldn't load the grid's figures. Try again in a moment.</div>
      )}
    </>
  );
}

/** A figure in a card's corner, with what it is above it. */
function Corner({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className="flex flex-none flex-col items-end gap-0.5">
      <span className="text-xs text-ink-faint">{label}</span>
      <span
        className={cn("text-[28px] leading-8 font-light tracking-[-1px] whitespace-nowrap tabular-nums", className)}
      >
        {children}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- the market

/**
 * The region's wholesale market from AEMO: the price now in the corner, through today and ahead to the early hours
 * (pre-dispatch, dashed) in cents a kWh with where a spike starts marked when prices get near it, the region (which can
 * be changed, or AEMO not followed), and AEMO's notices about it from the last two days. Without `notices`, just the
 * price.
 */
export function MarketCard({
  grid,
  now,
  notices = true,
  className,
}: {
  grid: GridView;
  now: number;
  notices?: boolean;
  className?: string;
}) {
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
  const tomorrow = addDays(start, 1);
  const today = pts.filter((x) => x.t >= start && x.t <= tomorrow && x.v != null);
  const top = Math.max(...today.map((x) => x.v ?? 0));
  // AEMO's forecast past midnight, its dearest half hour.
  const later = Math.max(0, ...pts.filter((x) => x.t > tomorrow).map((x) => x.v ?? 0));
  const spike = grid.limits.spike / 10;
  const price = grid.market?.price;
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
  const region = (
    <Select
      aria-label="Region"
      value={chosen}
      onChange={(e) => choose(e.target.value)}
      disabled={save.isPending}
      className="h-8 rounded-full px-3 text-[13px]"
    >
      <option value="auto">{autoName}</option>
      {REGIONS.map((r) => (
        <option key={r.id} value={r.id}>
          {r.label}
        </option>
      ))}
      <option value="none">Don't follow AEMO</option>
    </Select>
  );
  return (
    <Card className={className}>
      <div className="flex items-end justify-between gap-3">
        <TitleBlock
          className="min-w-0 flex-1"
          title="Wholesale market"
          sub={
            grid.enabled
              ? `What power sells for in ${grid.region_name ?? "your region"} before network charges, from AEMO every five minutes`
              : "Choose your region for its wholesale price and AEMO's warnings about tight supply"
          }
        />
        {grid.enabled && (
          <Corner label="Now" className={price != null && price >= grid.limits.spike ? "text-warn" : undefined}>
            {wholesaleCents(price)}
            <span className="text-sm font-normal tracking-normal text-ink-faint">/kWh</span>
          </Corner>
        )}
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
            {today.length > 0 && (
              <span className="tabular-nums">
                Today up to {wholesaleCents(top * 10)}
                {later >= spike && <span className="text-warn"> · Tomorrow up to {wholesaleCents(later * 10)}</span>}
              </span>
            )}
          </div>
          <TimeLine
            label="Wholesale price through the day, with AEMO's forecast"
            points={pts}
            start={start}
            end={end}
            now={now}
            color={COLOR.lilac}
            height={150}
            marks={
              Math.max(top, later) >= spike * 0.6 ? [{ v: spike, label: "Spike", color: alpha(COLOR.warn, 0.7) }] : []
            }
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
        </>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-faint">
        {region}
        {grid.enabled && grid.market?.demand != null && (
          <span className="tabular-nums">
            {grid.region_name} is using {(grid.market.demand / 1000).toFixed(1)} GW
          </span>
        )}
        {grid.enabled && grid.fetched_at && <span className="tabular-nums">Updated {hhmm(grid.fetched_at)}</span>}
      </div>
      {notices && grid.enabled && (
        <div className="flex flex-col gap-1.5 border-t border-line-subtle pt-4">
          <span className="text-[13px] font-medium text-ink">AEMO notices</span>
          <NoticeList grid={grid} />
        </div>
      )}
    </Card>
  );
}

/** AEMO's notices about the region over the last two days that matter to a household, current ones first. */
function NoticeList({ grid }: { grid: GridView }) {
  const list = [...grid.notices].sort((a, b) => Number(b.active) - Number(a.active) || b.at - a.at);
  return list.length ? (
    <ul className="-my-1 flex flex-col">
      {list.map((n) => (
        <NoticeRow key={n.id} n={n} />
      ))}
    </ul>
  ) : (
    <div className="text-[13px] text-ink-faint">
      All quiet in the last two days. No tight supply, load shedding or system events in{" "}
      {grid.region_name ?? "your region"}.
    </div>
  );
}

/** AEMO's notices on their own, as a dashboard widget (the page has them in the market card). */
export function NoticesCard({ grid }: { grid: GridView }) {
  if (!grid.enabled) return null;
  return (
    <Card>
      <TitleBlock title="AEMO notices" sub={`About ${grid.region_name ?? "your region"}, from the last two days`} />
      <NoticeList grid={grid} />
    </Card>
  );
}

function NoticeRow({ n }: { n: MarketNotice }) {
  const [open, setOpen] = useState(false);
  const color =
    !n.active || n.level === "info" ? alpha(COLOR.fg, 0.25) : n.level === "critical" ? COLOR.danger : COLOR.warn;
  const when = `${weekdayShort.format(n.at * 1000)} ${hhmm(n.at)}`;
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

// ---------------------------------------------------------------------------------------------- quality

function points(series: HistorySeries | undefined, field: string): LinePoint[] {
  if (!series) return [];
  const vs = series[field] ?? [];
  return series.t.map((t, i) => ({ t, v: vs[i] ?? null }));
}

function stats(pts: LinePoint[]) {
  const vs = pts.map((x) => x.v).filter((v): v is number => v != null && v > 0);
  if (!vs.length) return null;
  return { min: Math.min(...vs), max: Math.max(...vs) };
}

/**
 * The grid at the house, as the inverter measures it: its voltage now in the corner and through today against the
 * range the standard allows (high voltage makes the inverter hold back exports), and its frequency under it.
 */
export function QualityCard({
  series,
  p,
  grid,
  start,
  now,
  className,
}: {
  series: HistorySeries | undefined;
  p: Snapshot | null;
  grid: GridView | undefined;
  start: number;
  now: number;
  className?: string;
}) {
  const volts = points(series, "grid_voltage").map((x) => ({ ...x, v: x.v != null && x.v > 50 ? x.v : null }));
  const hz = points(series, "grid_freq");
  const vs = stats(volts);
  const fs = stats(hz);
  const lim = grid?.limits ?? { voltage_low: 216, voltage_high: 253, freq_low: 49.85, freq_high: 50.15, spike: 300 };
  const step = series && series.t.length > 1 ? series.t[1] - series.t[0] : 300;
  const high = volts.filter((x) => x.v != null && x.v > lim.voltage_high).length * step;
  const v = p?.grid_voltage != null && p.grid_voltage > 50 ? p.grid_voltage : null;
  const f = p?.grid_freq != null && p.grid_freq > 0 ? p.grid_freq : null;
  const vBad = v != null && (v > lim.voltage_high || v < lim.voltage_low);
  const fBad = f != null && (f > lim.freq_high || f < lim.freq_low);
  const noVoltage = series && !vs && v == null;
  return (
    <Card className={className}>
      <div className="flex items-end justify-between gap-3">
        <TitleBlock
          className="min-w-0 flex-1"
          title="Grid quality"
          sub={
            high > 0
              ? `Above ${lim.voltage_high} V for ${duration(high)} today, so your inverter may have held back exports`
              : vBad || fBad
                ? "Outside the usual range right now"
                : "Steady at your house, within the standard's range"
          }
        />
        <Corner label="Voltage now" className={vBad ? "text-warn" : undefined}>
          {v != null ? `${v.toFixed(0)} V` : DASH}
        </Corner>
      </div>
      {noVoltage ? (
        <div className="text-[13px] text-ink-faint">Your inverter doesn't report the grid's voltage.</div>
      ) : series ? (
        <TimeLine
          label="Grid voltage through the day"
          points={volts}
          start={start}
          end={addDays(start, 1)}
          now={now}
          color={COLOR.teal}
          height={120}
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
        <Skeleton className="h-[140px] rounded-2xl" />
      )}
      {(vs || f != null) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-faint tabular-nums">
          {vs && (
            <span>
              {vs.min.toFixed(0)} to {vs.max.toFixed(0)} V today
            </span>
          )}
          {f != null && (
            <span>
              Frequency <span className={fBad ? "text-warn" : "text-ink-muted"}>{f.toFixed(2)} Hz</span>
              {fs && `, ${fs.min.toFixed(2)} to ${fs.max.toFixed(2)} today`}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
