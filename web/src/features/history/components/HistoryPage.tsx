import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useCallback, useMemo, useRef } from "react";
import { costsQuery } from "~/features/common/readings/api";
import { dailyQuery, statsQuery } from "~/features/history/api";
import { PageBody } from "~/features/common/layout/components/AppShell";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { useNow } from "~/features/common/time/hooks";
import { cn } from "~/features/common/ui/utils";
import { dayMonth } from "~/features/common/formatting/utils/date";
import { dollars, intAU } from "~/features/common/formatting/utils/number";
import { addDays, fromDateKey, midnight } from "~/features/common/time/utils";
import { DayPanel } from "~/features/history/components/DayPanel";
import { MonthlySources } from "~/features/history/components/MonthlySources";
import { StandoutDays } from "~/features/history/components/StandoutDays";
import { MonthCalendar, YearHeatmap } from "~/features/history/components/YearCalendar";
import { daySearch, lastDay, METRIC_KEYS, rangeOf, yearOf, type Metric } from "~/features/history/utils/search";
import {
  buildDays,
  heatCells,
  heatColor,
  METRICS,
  monthsOf,
  standoutsOf,
  totalsOf,
} from "~/features/history/utils/year";

const route = getRouteApi("/_app/history");

// Keep today's numbers moving: a view that includes today refreshes every 10 minutes (today's curve, every poll).
const REFRESH = 10 * 60_000;

const PILLS =
  "flex max-w-full [scrollbar-width:none] gap-1 overflow-x-auto rounded-full border border-line-subtle bg-[#161616] p-1 [&::-webkit-scrollbar]:hidden";
const pill = (on: boolean) =>
  cn(
    "flex flex-none items-center gap-2 rounded-full border-0 px-4 py-[9px] text-sm font-medium whitespace-nowrap transition-colors duration-200 ease-[ease] max-sm:px-3.5",
    on ? "bg-ink text-ink-inverse" : "bg-transparent text-[#a0a0a0] hover:text-ink",
  );

/** "2 Oct 2025". */
const dmy = (ts: number) => `${dayMonth(ts)} ${yearOf(ts)}`;

function Total({ label, value, unit, sub }: { label: string; value: string; unit: string; sub: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 pt-6 pr-6 max-md:pt-5 max-md:pr-3">
      <span className="text-[13px] text-ink-dim">{label}</span>
      <span className="text-[44px] leading-12 font-light tracking-[-2px] whitespace-nowrap text-white tabular-nums max-md:text-[32px] max-md:leading-9 max-md:tracking-[-1.2px]">
        {value}
        <small className="ml-1.5 text-base font-normal tracking-normal text-[#7a7a7a]">{unit}</small>
      </span>
      <span className="text-xs text-[#7a7a7a] tabular-nums">{sub}</span>
    </div>
  );
}

/**
 * Recorded history for the last 12 months or a calendar year: totals, where each month's power
 * came from, every day as a heatmap (pick what to colour by), standout days, and one day in detail.
 */
export function HistoryPage() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const today = midnight(useNow(60_000));
  const thisYear = yearOf(today);
  const year = search.year;
  const metric = search.metric ?? "gen";
  const range = useMemo(() => rangeOf(year, today), [year, today]);
  const last = lastDay(range);
  const dayTs = search.day ? fromDateKey(search.day) : last;
  const { start, end } = range;

  const refetchInterval = end > today ? REFRESH : false;
  const daily = useQuery({ ...dailyQuery(start, end), refetchInterval });
  const costs = useQuery({ ...costsQuery(start, end), refetchInterval });
  const historyFrom = useQuery(statsQuery).data?.history_from ?? null;

  const days = useMemo(
    () => buildDays(start, end, today, daily.data, costs.data?.days),
    [start, end, today, daily.data, costs.data],
  );
  const cells = useMemo(() => heatCells(days, metric), [days, metric]);
  const totals = useMemo(() => totalsOf(days), [days]);
  const months = useMemo(() => monthsOf(days), [days]);
  const standouts = useMemo(() => standoutsOf(days), [days]);
  const loaded = !!(daily.data && costs.data);
  const lead = (new Date(start * 1000).getDay() + 6) % 7;
  const selected = Math.round((dayTs - start) / 86400);
  const { label, color } = METRICS[metric];
  const firstYear = historyFrom ? Math.min(thisYear, yearOf(historyFrom)) : thisYear;
  const years = Array.from({ length: thisYear - firstYear + 1 }, (_, k) => thisYear - k);
  const viewName = year === undefined ? "the last 12 months" : String(year);
  const startsLate = historyFrom != null && midnight(historyFrom) > start;

  // The view lives in the URL, but changing it isn't a new page: resetScroll: false keeps the
  // reader where they are (the router otherwise jumps to the top on every navigation).
  const select = useCallback(
    (ts: number) => {
      if (ts < start || ts > last) return;
      navigate({
        search: (prev) => ({ ...prev, ...daySearch(ts, range) }),
        replace: true,
        resetScroll: false,
      });
    },
    [navigate, start, last, range],
  );
  const dayRef = useRef<HTMLElement>(null);
  // Choosing a day further up the page brings its detail into view.
  const selectAndShow = useCallback(
    (ts: number) => {
      select(ts);
      dayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [select],
  );
  const setYear = (y: number | undefined) =>
    navigate({ search: (prev) => ({ year: y, metric: prev.metric }), resetScroll: false });
  const setMetric = (m: Metric) =>
    navigate({
      search: (prev) => ({ ...prev, metric: m === "gen" ? undefined : m }),
      replace: true,
      resetScroll: false,
    });

  return (
    <>
      <PageHeader title="History" sub="Solar generation, home use, and grid activity over time" />
      <PageBody className="gap-10 max-md:gap-8">
        <div className="flex flex-wrap items-center justify-between gap-5 max-md:gap-4">
          <div className="flex max-w-full min-w-0 flex-col gap-2.5">
            <div role="tablist" aria-label="Period" className={PILLS}>
              <button
                type="button"
                role="tab"
                aria-selected={year === undefined}
                onClick={() => setYear(undefined)}
                className={pill(year === undefined)}
              >
                Last 12 months
              </button>
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  role="tab"
                  aria-selected={year === y}
                  onClick={() => setYear(y)}
                  className={pill(year === y)}
                >
                  {y}
                </button>
              ))}
            </div>
            <span className="pl-1 font-mono text-xs tracking-[1.5px] text-[#7a7a7a] uppercase">
              {dmy(start)} to {dmy(last)}
            </span>
          </div>
          <div role="tablist" aria-label="Colour days by" className={PILLS}>
            {METRIC_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={k === metric}
                onClick={() => setMetric(k)}
                className={pill(k === metric)}
              >
                <i className="size-[7px] rounded-full" style={{ background: METRICS[k].color }} />
                {METRICS[k].label}
              </button>
            ))}
          </div>
        </div>

        {loaded && (startsLate || !totals.days) && (
          <div className="rounded-2xl border border-line-subtle bg-surface px-5 py-4 text-sm leading-[22px] text-pretty text-[#a0a0a0]">
            {totals.days
              ? `Your history starts on ${dmy(historyFrom!)}, so ${viewName} only covers part of the time.`
              : `There's no data for ${viewName} yet. Days fill in as your system records them.`}
          </div>
        )}

        {loaded && totals.days > 0 && (
          <>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-y-2 border-t border-white/8 max-md:grid-cols-2">
              <Total
                label="Solar generated"
                value={intAU(totals.gen)}
                unit="kWh"
                sub={`${(totals.gen / totals.days).toFixed(1)} kWh a day on average`}
              />
              <Total
                label="Home use"
                value={intAU(totals.home)}
                unit="kWh"
                sub={`${(totals.home / totals.days).toFixed(1)} kWh a day on average`}
              />
              <Total
                label="Self-sufficiency"
                value={totals.home > 0 ? String(Math.round(((totals.home - totals.imp) / totals.home) * 100)) : "—"}
                unit="%"
                sub={`${totals.greatDays} ${totals.greatDays === 1 ? "day" : "days"} at 90% or more`}
              />
              <Total
                label="Grid import"
                value={intAU(totals.imp)}
                unit="kWh"
                sub={`${(totals.imp / totals.days).toFixed(1)} kWh a day on average`}
              />
              <Total
                label="Exported to grid"
                value={intAU(totals.exp)}
                unit="kWh"
                sub={`Earned ${dollars(totals.credit)} in feed-in credit`}
              />
              <Total
                label="Saved"
                value={dollars(totals.saved)}
                unit="AUD"
                sub={`About ${dollars(totals.saved / Math.max(1, totals.months))} a month`}
              />
            </div>
            <MonthlySources months={months} />
          </>
        )}

        <div className="flex flex-col gap-3">
          <YearHeatmap cells={cells} lead={lead} selected={selected} onSelect={select} />
          <MonthCalendar
            cells={cells}
            selected={selected}
            onSelect={selectAndShow}
            sub={`${label} per day · select a day`}
          />
          <div className="ml-9 flex flex-wrap items-center justify-between gap-4 text-[13px] text-ink-dim max-md:ml-0 max-md:justify-end">
            <span className="max-md:hidden">
              {loaded && totals.days > 0 && `${label} per day · select a day to see it hour by hour`}
            </span>
            <div className="flex items-center gap-[5px] text-xs text-[#7a7a7a]">
              Less
              {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                <i key={v} className="size-3.5 rounded-[4px]" style={{ background: heatColor(color, v) }} />
              ))}
              More
            </div>
          </div>
        </div>

        <StandoutDays standouts={standouts} selected={selected} onSelect={selectAndShow} />

        <DayPanel
          ref={dayRef}
          day={days[selected]}
          isToday={dayTs === today}
          onPrev={dayTs > start ? () => select(addDays(dayTs, -1)) : undefined}
          onNext={dayTs < last ? () => select(addDays(dayTs, 1)) : undefined}
        />
      </PageBody>
    </>
  );
}
