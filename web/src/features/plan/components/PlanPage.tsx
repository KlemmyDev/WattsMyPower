import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useAmberPrices } from "~/features/amber/hooks";
import { costsQuery, historyQuery } from "~/features/common/readings/api";
import type { HistorySeries } from "~/features/common/readings/types";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Card, Footnote, TitleBlock } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { useForecast, useForecastAccuracy } from "~/features/common/weather/hooks";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { useNow } from "~/features/common/time/hooks";
import { addDays, dateKey, midnight } from "~/features/common/time/utils";
import { shortDay } from "~/features/common/formatting/utils/date";
import { locationLabel, reserveOf } from "~/features/common/energy/utils";
import { AccuracyCard } from "~/features/plan/components/AccuracyCard";
import { BestTimes } from "~/features/plan/components/BestTimes";
import { HourStrip } from "~/features/plan/components/HourStrip";
import { OutlookDays } from "~/features/plan/components/OutlookDays";
import { PlanChart } from "~/features/plan/components/PlanChart";
import { bestTimes, notices, planDays } from "~/features/plan/utils";
import { ratesFor } from "~/features/plan/utils/rates";

const FIELDS = ["pv_power", "load_power", "grid_power", "battery_soc"];

/** Today's highest battery level so far, and when it first reached full. */
function recordedBattery(series: HistorySeries | undefined) {
  let maxSoc: number | null = null;
  let fullAt: number | null = null;
  series?.t.forEach((t, i) => {
    const soc = series.battery_soc?.[i];
    if (soc == null) return;
    maxSoc = Math.max(maxSoc ?? 0, soc);
    if (fullAt == null && soc >= 99.5) fullAt = t;
  });
  return { maxSoc, fullAt };
}

export function PlanPage() {
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
  const [selected, setSelected] = useState(0);

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
        <Card>
          <div className="text-sm text-ink-faint">Loading the forecast</div>
        </Card>
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
          <OutlookDays days={days} selected={selected} onSelect={setSelected} now={now} />
          <Card id="plan-day" role="tabpanel" aria-labelledby={`plan-tab-${selected}`}>
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
                rates={rates}
              />
              <div className="flex flex-col gap-4">
                <h3 className="text-[15px] font-semibold">Best times to use power</h3>
                <BestTimes times={times} today={day.today} />
              </div>
            </div>
          </Card>
          <Card aria-labelledby="h-hbh">
            <TitleBlock
              id="h-hbh"
              title="Hour by hour"
              sub="Forecast solar per hour and the battery level at the end of each hour"
            />
            <HourStrip forecast={forecast} hours={day.hours} now={day.today} />
          </Card>
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
