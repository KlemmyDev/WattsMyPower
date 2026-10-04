import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useLocation } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { costsQuery } from "~/features/common/readings/api";
import { dailyQuery, statsQuery } from "~/features/history/api";
import { PageBody } from "~/features/common/layout/components/AppShell";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { useNow } from "~/features/common/time/hooks";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { cn } from "~/features/common/ui/utils";
import { heatColor } from "~/features/common/theme/utils/colors";
import { dayMonth } from "~/features/common/formatting/utils/date";
import { dollars, energyParts, kWh } from "~/features/common/formatting/utils/number";
import { addDays, dateKey, fromDateKey, midnight } from "~/features/common/time/utils";
import { useFahrenheit } from "~/features/common/weather/hooks";
import { weatherDaysQuery } from "~/features/weather/api";
import { DayPanel } from "~/features/history/components/DayPanel";
import { MonthlySources } from "~/features/history/components/MonthlySources";
import { StandoutDays } from "~/features/history/components/StandoutDays";
import { MonthCalendar, YearHeatmap } from "~/features/history/components/YearCalendar";
import { daySearch, lastDay, METRIC_KEYS, rangeOf, yearOf, type Metric } from "~/features/history/utils/search";
import {
  buildDays,
  heatCells,
  monthsOf,
  SKIES,
  skyCounts,
  standoutsOf,
  TABS,
  totalsOf,
  weatherCells,
} from "~/features/history/utils/year";

const route = getRouteApi("/_app/history");

// Keep today's numbers moving: a view that includes today refreshes every 10 minutes (today's curve, every poll).
const REFRESH = 10 * 60_000;

const PILLS =
  "flex max-w-full [scrollbar-width:none] gap-1 overflow-x-auto rounded-full border border-line-subtle bg-tabs p-1 [&::-webkit-scrollbar]:hidden";
const pill = (on: boolean) =>
  cn(
    "flex flex-none items-center gap-2 rounded-full border-0 px-4 py-[9px] text-sm font-medium whitespace-nowrap transition-colors duration-200 ease-[ease] max-sm:px-3.5",
    on ? "bg-ink text-ink-inverse" : "bg-transparent text-ink-quiet hover:text-ink",
  );

/** A total's figure and unit: "1,013" kWh, or "395" Wh under one. */
const energy = (v: number) => {
  const [value, unit] = energyParts(v, true);
  return { value, unit };
};

/** "2 Oct 2025". */
const dmy = (ts: number) => `${dayMonth(ts)} ${yearOf(ts)}`;

function Total({ label, value, unit, sub }: { label: string; value: string; unit: string; sub: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 pt-6 pr-6 max-md:pt-5 max-md:pr-3">
      <span className="text-[13px] text-ink-dim">{label}</span>
      <span className="text-[44px] leading-12 font-light tracking-[-2px] whitespace-nowrap text-fg tabular-nums max-md:text-[32px] max-md:leading-9 max-md:tracking-[-1.2px]">
        {value}
        <small className="ml-1.5 text-base font-normal tracking-normal text-ink-label">{unit}</small>
      </span>
      <span className="text-xs text-ink-label tabular-nums">{sub}</span>
    </div>
  );
}

/**
 * Recorded history for a calendar year, January to December: totals, where each month's power
 * came from, every day as a heatmap (pick what to colour by), standout days, and one day in detail.
 */
export function HistoryPage() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const today = midnight(useNow(60_000));
  const thisYear = yearOf(today);
  const year = search.year; // undefined: this year
  const metric = search.metric ?? "gen";
  const range = useMemo(() => rangeOf(year, today), [year, today]);
  const last = lastDay(range);
  const dayTs = search.day ? fromDateKey(search.day) : last;
  const { start, end } = range;
  // Readings only go up to today: the rest of this year is drawn empty.
  const until = Math.min(end, addDays(today, 1));

  const refetchInterval = end > today ? REFRESH : false;
  const daily = useQuery({ ...dailyQuery(start, until), refetchInterval });
  const costs = useQuery({ ...costsQuery(start, until), refetchInterval });
  const historyFrom = useQuery(statsQuery).data?.history_from ?? null;
  const showWeather = metric === "weather";
  const weather = useQuery({
    ...weatherDaysQuery(dateKey(start), dateKey(until)),
    enabled: showWeather,
    refetchInterval: end > today ? REFRESH : false,
  });
  const fahrenheit = useFahrenheit();

  const days = useMemo(
    () => buildDays(start, end, today, daily.data, costs.data?.days),
    [start, end, today, daily.data, costs.data],
  );
  const cells = useMemo(
    () => (metric === "weather" ? weatherCells(days, weather.data, fahrenheit) : heatCells(days, metric)),
    [days, metric, weather.data, fahrenheit],
  );
  const skies = useMemo(() => skyCounts(days, weather.data), [days, weather.data]);
  const weatherKnown = Object.values(skies).reduce((a, n) => a + n, 0);
  const totals = useMemo(() => totalsOf(days), [days]);
  const months = useMemo(() => monthsOf(days), [days]);
  const standouts = useMemo(() => standoutsOf(days), [days]);
  const loaded = !!(daily.data && costs.data);
  const lead = (new Date(start * 1000).getDay() + 6) % 7;
  const selected = Math.round((dayTs - start) / 86400);
  const { label, color } = TABS[metric];
  const perDay = showWeather ? "The weather each day" : `${label} per day`;
  const firstYear = historyFrom ? Math.min(thisYear, yearOf(historyFrom)) : thisYear;
  const years = Array.from({ length: thisYear - firstYear + 1 }, (_, k) => thisYear - k);
  const viewName = String(year ?? thisYear);
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
  // Opened at "#day" (the Overview's "Today in History"): go to the day's chart once everything above it has
  // loaded, so it doesn't move off as the year's totals and heatmap fill in. Once per arrival, on any screen size.
  const hash = useLocation({ select: (l) => l.hash });
  const arrived = useRef(false);
  useEffect(() => {
    if (hash !== "day") {
      arrived.current = false;
      return;
    }
    if (!loaded || arrived.current) return;
    arrived.current = true;
    requestAnimationFrame(() => dayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [hash, loaded]);
  const setYear = (y: number) =>
    navigate({ search: (prev) => ({ year: y === thisYear ? undefined : y, metric: prev.metric }), resetScroll: false });
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
        <div className="flex max-w-full min-w-0 flex-col gap-2.5">
          <div role="tablist" aria-label="Period" className={cn(PILLS, "self-start")}>
            {years.map((y) => (
              <button
                key={y}
                type="button"
                role="tab"
                aria-selected={(year ?? thisYear) === y}
                onClick={() => setYear(y)}
                className={pill((year ?? thisYear) === y)}
              >
                {y}
              </button>
            ))}
          </div>
          <span className="pl-1 font-mono text-xs tracking-[1.5px] text-ink-label uppercase">
            {dmy(start)} to {dmy(last)}
          </span>
        </div>

        {loaded && (startsLate || !totals.days) && (
          <div className="rounded-2xl border border-line-subtle bg-surface px-5 py-4 text-sm leading-[22px] text-pretty text-ink-quiet">
            {totals.days
              ? `Your history starts on ${dmy(historyFrom!)}, so ${viewName} only covers part of the time.`
              : `There's no data for ${viewName} yet. Days fill in as your system records them.`}
          </div>
        )}

        {loaded && totals.days > 0 && (
          <>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-y-2 border-t border-fg/8 max-md:grid-cols-2">
              <Total
                label="Solar generated"
                {...energy(totals.gen)}
                sub={`${kWh(totals.gen / totals.days)} a day on average`}
              />
              <Total
                label="Home use"
                {...energy(totals.home)}
                sub={`${kWh(totals.home / totals.days)} a day on average`}
              />
              <Total
                label="Self-sufficiency"
                value={totals.home > 0 ? String(Math.round(((totals.home - totals.imp) / totals.home) * 100)) : "—"}
                unit="%"
                sub={`${totals.greatDays} ${totals.greatDays === 1 ? "day" : "days"} at 90% or more`}
              />
              <Total
                label="Grid import"
                {...energy(totals.imp)}
                sub={`${kWh(totals.imp / totals.days)} a day on average`}
              />
              <Total
                label="Exported to grid"
                {...energy(totals.exp)}
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
          {/* What the heatmap colours days by, right above it. */}
          <div role="tablist" aria-label="Colour days by" className={cn(PILLS, "mb-2 self-start")}>
            {METRIC_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={k === metric}
                onClick={() => setMetric(k)}
                className={pill(k === metric)}
              >
                <i className="size-[7px] rounded-full" style={{ background: TABS[k].color }} />
                {TABS[k].label}
              </button>
            ))}
          </div>
          {showWeather && weather.data && loaded && weatherKnown < totals.days / 2 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line-subtle bg-surface px-5 py-4 text-sm text-pretty text-ink-quiet">
              <span>
                {weatherKnown
                  ? `Weather is stored for ${weatherKnown} of the ${totals.days} days with readings.`
                  : "No weather is stored for these days yet."}{" "}
                Past weather can be filled in from Open-Meteo.
              </span>
              <ButtonLink to="/settings/integrations/weather" variant="link" size="sm">
                Fill in past weather
              </ButtonLink>
            </div>
          )}
          <YearHeatmap cells={cells} lead={lead} selected={selected} onSelect={select} />
          <MonthCalendar cells={cells} selected={selected} onSelect={selectAndShow} sub={`${perDay} · select a day`} />
          <div className="ml-9 flex flex-wrap items-center justify-between gap-4 text-[13px] text-ink-dim max-md:ml-0 max-md:justify-end">
            <span className="max-md:hidden">
              {loaded && totals.days > 0 && `${perDay} · select a day to see it hour by hour`}
            </span>
            {showWeather ? (
              <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1.5 text-xs text-ink-label">
                {SKIES.map((s) => (
                  <span key={s.key} className="flex items-center gap-1.5 tabular-nums">
                    <i className="size-3.5 rounded-[4px]" style={{ background: s.fill }} />
                    {s.label}
                    {weather.data ? ` · ${skies[s.key]}` : ""}
                  </span>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-[5px] text-xs text-ink-label">
                Less
                {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                  <i key={v} className="size-3.5 rounded-[4px]" style={{ background: heatColor(color, v) }} />
                ))}
                More
              </div>
            )}
          </div>
        </div>

        <StandoutDays standouts={standouts} onSelect={selectAndShow} />

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
