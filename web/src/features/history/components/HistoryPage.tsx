import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useLocation } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { costsQuery } from "~/features/common/readings/api";
import { dailyQuery, statsQuery } from "~/features/history/api";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { useNow } from "~/features/common/time/hooks";
import { dayMonth } from "~/features/common/formatting/utils/date";
import { addDays, dateKey, fromDateKey, midnight, mondayFirst } from "~/features/common/time/utils";
import { useFahrenheit } from "~/features/common/weather/hooks";
import { weatherDaysQuery } from "~/features/weather/api";
import { DayPanel } from "~/features/history/components/DayPanel";
import { HistoryDays } from "~/features/history/components/HistoryDays";
import { HistoryHero } from "~/features/history/components/HistoryHero";
import { MonthTable } from "~/features/history/components/MonthTable";
import { StandoutDays } from "~/features/history/components/StandoutDays";
import { daySearch, lastDay, rangeOf, yearBefore, yearOf, type Metric } from "~/features/history/utils/search";
import {
  buildDays,
  heatCells,
  monthsOf,
  skyCounts,
  standoutsOf,
  totalsOf,
  weatherCells,
  type Month,
} from "~/features/history/utils/year";

const route = getRouteApi("/_app/history");

// Keep today's numbers moving: a view that includes today refreshes every 10 minutes (today's curve, every poll).
const REFRESH = 10 * 60_000;

/** "2 Oct 2025". */
const dmy = (ts: number) => `${dayMonth(ts)} ${yearOf(ts)}`;

/**
 * Recorded history for a calendar year, January to December: the year in one card (how much of the house's use solar
 * and the battery covered against the year before, what it saved, where its power came from, a bar a month), every day
 * as a heatmap (pick what to colour by), one day in detail, the year's standout days and each month in figures. A
 * month opens its days; a day opens hour by hour.
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
  // The same stretch of the year before, to compare against, once there's history that far back.
  const before = useMemo(() => yearBefore(start, until), [start, until]);
  const hasBefore = historyFrom != null && historyFrom < before.until;
  const prevDaily = useQuery({ ...dailyQuery(before.start, before.until), enabled: hasBefore });
  const prevCosts = useQuery({ ...costsQuery(before.start, before.until), enabled: hasBefore });

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
  const prev = useMemo(() => {
    if (!prevDaily.data || !prevCosts.data) return null;
    const t = totalsOf(buildDays(before.start, before.until, today, prevDaily.data, prevCosts.data.days));
    // Only against as much of it to go on (a history that starts partway through it isn't a fair comparison).
    return t.days >= totals.days * 0.9 ? t : null;
  }, [prevDaily.data, prevCosts.data, before, today, totals.days]);
  const months = useMemo(() => monthsOf(days), [days]);
  const standouts = useMemo(() => standoutsOf(days), [days]);
  const loaded = !!(daily.data && costs.data);
  const lead = mondayFirst(start);
  const selected = Math.round((dayTs - start) / 86400);
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
  const daysRef = useRef<HTMLElement>(null);
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
  // Choosing a month opens its days: its first day with readings, and the heatmap brought into view.
  const showMonth = useCallback(
    (m: Month) => {
      select(m.first);
      daysRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [select],
  );
  const setYear = (y: number) =>
    navigate({ search: (prev) => ({ year: y === thisYear ? undefined : y, metric: prev.metric }), resetScroll: false });
  const setMetric = (m: Metric) =>
    navigate({
      search: (prev) => ({ ...prev, metric: m === "gen" ? undefined : m }),
      replace: true,
      resetScroll: false,
    });

  const shown = year ?? thisYear;
  // "28 Sep to 12 Oct 2026": from when the history starts, if that's partway through the year.
  const from = startsLate && totals.days ? midnight(historyFrom!) : start;
  const span = `${dayMonth(from)} to ${dmy(last)}${from > start ? ", since your history starts" : ""}`;
  const note = totals.days
    ? undefined
    : historyFrom != null && historyFrom >= end
      ? `Your history starts on ${dmy(historyFrom)}, so there's nothing for ${viewName}.`
      : `There's no data for ${viewName} yet. Days fill in as your system records them.`;
  // A year opened by its address (a link from Bills) stays in the picker, so there's a way back.
  const pickable = years.includes(shown) ? years : [...years, shown].sort((a, b) => b - a);
  const empty = loaded && !totals.days;

  return (
    <>
      <PageHeader title="History" sub="How your solar, home and grid have gone, day by day and month by month" />
      <div className="flex flex-col gap-5">
        <HistoryHero
          year={shown}
          years={pickable}
          onYear={setYear}
          span={span}
          note={note}
          loaded={loaded}
          running={end > today}
          totals={totals}
          prev={prev}
          months={months}
          onMonth={showMonth}
        />
        {!empty && (
          <HistoryDays
            ref={daysRef}
            cells={cells}
            lead={lead}
            selected={selected}
            onSelect={select}
            onShow={selectAndShow}
            metric={metric}
            onMetric={setMetric}
            days={totals.days}
            greatDays={totals.greatDays}
            skies={showWeather && weather.data ? skies : null}
            weatherKnown={weatherKnown}
          />
        )}
        {/* The chosen day on the left; the year's standout days and each month in figures on the right. */}
        {!empty && (
          <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1">
            <div className="flex min-w-0 flex-col gap-5">
              <DayPanel
                ref={dayRef}
                day={days[selected]}
                isToday={dayTs === today}
                onPrev={dayTs > start ? () => select(addDays(dayTs, -1)) : undefined}
                onNext={dayTs < last ? () => select(addDays(dayTs, 1)) : undefined}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              <StandoutDays standouts={standouts} onSelect={selectAndShow} />
              <MonthTable months={months} onSelect={showMonth} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
