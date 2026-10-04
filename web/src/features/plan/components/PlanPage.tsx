import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { useAmberPrices } from "~/features/amber/hooks";
import { costsQuery, historyQuery } from "~/features/common/readings/api";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Card, Footnote, TitleBlock } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { useForecast, useForecastAccuracy } from "~/features/common/weather/hooks";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { useNow } from "~/features/common/time/hooks";
import { addDays, dateKey, midnight } from "~/features/common/time/utils";
import { shortDay } from "~/features/common/formatting/utils/date";
import { locationLabel, reserveOf } from "~/features/common/energy/utils";
import { CarCharging } from "~/features/car/components/CarCharging";
import { AccuracyCard } from "~/features/plan/components/AccuracyCard";
import { BestTimes } from "~/features/plan/components/BestTimes";
import { DayBreakdown } from "~/features/plan/components/DayBreakdown";
import { MomentList } from "~/features/plan/components/Moments";
import { OutlookDays } from "~/features/plan/components/OutlookDays";
import { PlanChart } from "~/features/plan/components/PlanChart";
import { bestTimes, notices, planDays, recordedBattery } from "~/features/plan/utils";
import { moments } from "~/features/plan/utils/moments";
import { ratesFor } from "~/features/plan/utils/rates";
import { weatherDayQuery } from "~/features/weather/api";

const FIELDS = ["pv_power", "load_power", "grid_power", "battery_soc", "battery_power"];

/** The Plan page; `day` is the day open (0 today, 1 tomorrow, 2 the day after), from the address. */
export function PlanPage({ day: selected = 0 }: { day?: number }) {
  const forecast = useForecast();
  const accuracy = useForecastAccuracy();
  const snapshot = useSnapshot();
  const system = useSystem();
  const now = useNow();
  const prices = useAmberPrices(now);
  const start = midnight(now);
  const { data: costs } = useQuery(costsQuery(start));
  const { data: history } = useQuery(
    historyQuery({ start, end: addDays(start, 1), points: 288, fields: FIELDS, live: true }),
  );
  // Today's weather as recorded, for the hours the forecast no longer covers.
  const { data: weatherToday } = useQuery(weatherDayQuery(dateKey(start)));
  const navigate = useNavigate();
  // The day is in the address, so the Overview can link straight to tomorrow's and Back returns to it.
  const select = (i: number) =>
    navigate({ to: "/plan", search: { day: i || undefined }, replace: true, resetScroll: false });

  const tariff = system?.tariff;
  const rates = useMemo(() => (tariff ? ratesFor(tariff, prices) : null), [tariff, prices]);
  const range = accuracy?.range ?? null;
  const days = useMemo(
    () =>
      forecast
        ? planDays(forecast, {
            now,
            snapshot,
            tariff,
            rates,
            todayCost: costs?.days.find((d) => d.date === dateKey(start)),
            recorded: recordedBattery(history?.series),
            range,
          })
        : [],
    [forecast, now, start, snapshot, tariff, rates, costs, range, history],
  );
  const reserve = reserveOf(system);
  const notes = useMemo(() => notices(days, reserve, accuracy?.actual_mean), [days, reserve, accuracy]);
  const day = days[Math.min(selected, days.length - 1)];
  const times = useMemo(() => (day ? bestTimes(day.hours, rates) : null), [day, rates]);
  const events = useMemo(
    () => (day ? moments(day.hours, { now, end: addDays(day.start, 1), fullAt: day.battery.fullAt, reserve }) : []),
    [day, now, reserve],
  );

  // Opened on a day from a link (the Overview's "Tomorrow's plan"): bring its plan into view once it's drawn.
  const card = useRef<HTMLElement>(null);
  const linked = useRef(selected > 0);
  const ready = !!(forecast && day && times);
  useEffect(() => {
    if (!ready || !linked.current) return;
    linked.current = false;
    card.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [ready]);

  return (
    <>
      <PageHeader title="Plan" sub="What today and the next two days should bring, and the best times to use power" />
      <LocationChip />
      {forecast === null ? (
        <Card>
          <div className="text-sm text-ink-faint">
            Forecast unavailable. The server could not reach the Open-Meteo weather service, or the forecast is turned
            off.
          </div>
        </Card>
      ) : !forecast || !day || !times ? (
        // Shaped like the page to come: the three days, then the chosen day's chart.
        <div role="status" aria-label="Loading the forecast" className="flex flex-col gap-5">
          <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
            {[0, 1, 2].map((k) => (
              <Skeleton key={k} className="h-[214px]" />
            ))}
          </div>
          <Skeleton className="h-[420px] rounded-3xl" />
        </div>
      ) : (
        <>
          {notes.length > 0 && (
            <div className="flex flex-col gap-2">
              {notes.map((n) => (
                <Notice key={n.title} tone={n.tone} className="flex flex-col gap-0.5">
                  <span className="font-medium text-ink">{n.title}</span>
                  <span className="text-ink-muted">{n.sub}</span>
                </Notice>
              ))}
            </div>
          )}
          <OutlookDays days={days} selected={selected} onSelect={select} now={now} />
          {/* Keyed by day, so choosing another rises it into place afresh, chart drawing in. */}
          <Card
            key={day.key}
            ref={card}
            id="plan-day"
            role="tabpanel"
            aria-labelledby={`plan-tab-${selected}`}
            className="scroll-mt-6"
          >
            <TitleBlock
              title={`${day.label}, ${shortDay.format(new Date(day.start * 1000))}`}
              sub={
                day.today
                  ? "Recorded so far, then the forecast for the rest of the day"
                  : "Forecast solar, home use, battery level and grid power"
              }
            />
            <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-8 max-lg:grid-cols-1">
              <PlanChart
                day={day}
                series={day.today ? history?.series : undefined}
                now={now}
                soc0={day.today ? (snapshot?.battery_soc ?? null) : null}
                reserve={reserve}
                range={range ? [range.low, range.high] : null}
                windows={[...times.spare, ...times.paid, ...times.avoid]}
                moments={events}
                rates={rates}
                recordedSky={day.today ? weatherToday?.hours : undefined}
              />
              <div className="flex flex-col gap-6">
                {events.length > 0 && (
                  <div className="flex flex-col gap-4">
                    <h3 className="text-[15px] font-semibold">Key moments</h3>
                    <MomentList moments={events} />
                  </div>
                )}
                <div className="flex flex-col gap-4">
                  <h3 className="text-[15px] font-semibold">Best times to use power</h3>
                  <BestTimes times={times} today={day.today} />
                </div>
              </div>
            </div>
          </Card>
          <Card key={`breakdown-${day.key}`} aria-labelledby="h-breakdown">
            <TitleBlock
              id="h-breakdown"
              title="Home use and solar"
              sub={`${day.label}'s totals, and how they're worked out`}
            />
            <DayBreakdown day={day} forecast={forecast} system={system} />
          </Card>
          <CarCharging />
          <AccuracyCard accuracy={accuracy} />
          <Footnote>
            {forecast.calibration.fitted_hours >= 0.5
              ? `Solar forecast calibrated on ${forecast.calibration.fitted_hours} hours of your inverter's output.`
              : "Solar forecast not yet calibrated to your system. It needs a few daylight hours of data."}
            {forecast.model?.kind === "learned" &&
              ` It uses what it has learned from ${forecast.model.days} days of weather history.`}
          </Footnote>
        </>
      )}
    </>
  );
}

function LocationChip() {
  const system = useSystem();
  return (
    <div className="flex flex-wrap items-center gap-2 self-start rounded-full border border-chip-line bg-chip py-2 pr-3.5 pl-2.5 text-sm text-ink-muted">
      <span className="flex text-link">
        <Icon name="pin" size={16} />
      </span>
      <span>
        Outlook for <b className="font-semibold text-ink">{locationLabel(system)}</b>
      </span>
      <ButtonLink to="/settings/integrations/weather" variant="link" size="sm" className="ml-1">
        Change
      </ButtonLink>
    </div>
  );
}
