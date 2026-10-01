import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useCallback, useMemo, useRef } from "react";
import { costsQuery } from "~/features/common/readings/api";
import { dailyQuery } from "~/features/history/api";
import { PageBody } from "~/features/common/layout/components/AppShell";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { Button } from "~/features/common/ui/components/Button";
import { Icon } from "~/features/common/ui/components/Icon";
import { useNow } from "~/features/common/time/hooks";
import { cn } from "~/features/common/ui/utils";
import { dollars, intAU } from "~/features/common/formatting/utils/number";
import { addDays, fromDateKey, midnight } from "~/features/common/time/utils";
import { DayPanel } from "~/features/history/components/DayPanel";
import { daySearch, lastDay, METRIC_KEYS, yearOf, yearStart, type Metric } from "~/features/history/utils/search";
import { MonthGrid, YearHeatmap } from "~/features/history/components/YearCalendar";
import { buildDays, heatCells, heatColor, METRICS, yearTotals } from "~/features/history/utils/year";

const route = getRouteApi("/_app/history");

// Keep today's numbers moving: the current year refreshes every 10 minutes (today's curve, every poll).
const YEAR_REFRESH = 10 * 60_000;

function MetricTabs({ value, onChange }: { value: Metric; onChange: (m: Metric) => void }) {
  return (
    <div
      role="tablist"
      className="flex [scrollbar-width:none] gap-1 overflow-x-auto rounded-full border border-line-subtle bg-[#161616] p-1 max-md:grid max-md:w-full max-md:grid-cols-2 max-md:rounded-[20px]"
    >
      {METRIC_KEYS.map((k) => {
        const on = k === value;
        return (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(k)}
            className={cn(
              "flex flex-none items-center gap-2 rounded-full border-0 px-4 py-[9px] text-sm font-medium whitespace-nowrap transition-colors duration-200 ease-[ease] max-md:justify-center max-md:px-2.5",
              on ? "bg-ink text-ink-inverse" : "bg-transparent text-[#a0a0a0] hover:text-ink",
            )}
          >
            <i className="size-[7px] rounded-full" style={{ background: METRICS[k].color }} />
            {METRICS[k].label}
          </button>
        );
      })}
    </div>
  );
}

function Total({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="flex flex-col gap-1.5 pt-6 pr-6 max-md:pr-3 max-sm:pt-4">
      <span className="text-[13px] text-ink-dim">{label}</span>
      <span className="text-[48px] leading-[52px] font-light tracking-[-2px] text-white tabular-nums max-sm:text-[30px] max-sm:leading-9 max-sm:tracking-[-1px]">
        {value}
        <small className="ml-1.5 text-base font-normal tracking-normal text-[#7a7a7a]">{unit}</small>
      </span>
    </div>
  );
}

/** A year of days as a heatmap (pick what to colour by), with one day in detail underneath. */
export function HistoryPage() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const today = midnight(useNow(60_000));
  const thisYear = yearOf(today);
  const year = search.year ?? thisYear;
  const metric = search.metric ?? "gen";
  const dayTs = search.day ? fromDateKey(search.day) : lastDay(year, today);
  const isThisYear = year === thisYear;

  const start = yearStart(year);
  const end = yearStart(year + 1);
  const refetchInterval = isThisYear ? YEAR_REFRESH : false;
  const daily = useQuery({ ...dailyQuery(start, end), refetchInterval });
  const costs = useQuery({ ...costsQuery(start, end), refetchInterval });

  const days = useMemo(
    () => buildDays(start, end, today, daily.data, costs.data?.days),
    [start, end, today, daily.data, costs.data],
  );
  const cells = useMemo(() => heatCells(days, metric), [days, metric]);
  const totals = useMemo(() => yearTotals(days), [days]);
  const loaded = !!(daily.data && costs.data);
  const lead = (new Date(start * 1000).getDay() + 6) % 7;
  const selected = Math.round((dayTs - start) / 86400);
  const { label, color } = METRICS[metric];

  // Stepping past either end of the year moves into the next or previous year.
  const select = useCallback(
    (ts: number) => {
      if (ts > today) return;
      navigate({ search: (prev) => ({ ...daySearch(ts, today), metric: prev.metric }), replace: true });
    },
    [navigate, today],
  );
  const dayRef = useRef<HTMLElement>(null);
  const selectFromMonthGrid = useCallback(
    (ts: number) => {
      select(ts);
      // On phones the day's detail sits below the calendar: bring it into view.
      dayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [select],
  );
  // The previous year opens on its last day, the next on its first.
  const goToYear = (ts: number) => navigate({ search: (prev) => ({ ...daySearch(ts, today), metric: prev.metric }) });
  const setMetric = (m: Metric) =>
    navigate({ search: (prev) => ({ ...prev, metric: m === "gen" ? undefined : m }), replace: true });

  return (
    <>
      <PageHeader title="History" sub="Solar generation, home use, and grid activity over time" />
      <PageBody className="gap-10 max-sm:gap-7">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-2.5">
            <Button variant="round" aria-label="Previous year" onClick={() => goToYear(addDays(start, -1))}>
              <Icon name="chevL" size={18} />
            </Button>
            <span className="font-mono text-xs tracking-[1.5px] text-[#7a7a7a] uppercase">
              {isThisYear ? `${year} so far` : String(year)}
            </span>
            <Button variant="round" aria-label="Next year" onClick={() => goToYear(end)} disabled={isThisYear}>
              <Icon name="chevR" size={18} />
            </Button>
          </div>
          <MetricTabs value={metric} onChange={setMetric} />
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] border-t border-white/8 max-md:grid-cols-2">
          {loaded && (
            <>
              <Total label="Solar generated" value={intAU(totals.gen)} unit="kWh" />
              <Total
                label="Self-sufficiency"
                value={totals.home > 0 ? String(Math.round(((totals.home - totals.imp) / totals.home) * 100)) : "—"}
                unit="%"
              />
              <Total label="Exported to grid" value={intAU(totals.exp)} unit="kWh" />
              <Total label="Saved" value={dollars(totals.saved)} unit="AUD" />
            </>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <YearHeatmap cells={cells} lead={lead} selected={selected} onSelect={select} />
          <MonthGrid cells={cells} lead={lead} selected={selected} onSelect={selectFromMonthGrid} />
          <div className="ml-9 flex flex-wrap items-center justify-between gap-4 text-[13px] text-ink-dim max-md:ml-0">
            <span>
              {loaded &&
                (totals.days
                  ? `${label} per day · select a day to see it hour by hour`
                  : `No days recorded in ${year}. Days fill in as your system records data.`)}
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

        <DayPanel
          ref={dayRef}
          day={days[selected]}
          isToday={dayTs === today}
          onPrev={() => select(addDays(dayTs, -1))}
          onNext={() => select(addDays(dayTs, 1))}
        />
      </PageBody>
    </>
  );
}
