import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAmberPrices } from "~/features/amber/hooks";
import { reserveOf } from "~/features/common/energy/utils";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { costsQuery, historyQuery } from "~/features/common/readings/api";
import { addDays, dateKey, midnight } from "~/features/common/time/utils";
import { useForecast, useForecastAccuracy } from "~/features/common/weather/hooks";
import { bestTimes, notices, planDays, recordedBattery, type PlanDay } from "~/features/plan/utils";
import { moments } from "~/features/plan/utils/moments";
import { ratesFor } from "~/features/plan/utils/rates";
import { weatherDayQuery } from "~/features/weather/api";

const FIELDS = ["pv_power", "load_power", "grid_power", "battery_soc", "battery_power"];

/**
 * Everything the Plan page and its widgets work from: the forecast and how close it has been, today's readings so far
 * and its recorded weather, the prices, and from them today and the next two days, the battery's reserve and what's
 * worth knowing ahead of time.
 */
export function usePlan(now: number) {
  const forecast = useForecast();
  const accuracy = useForecastAccuracy();
  const snapshot = useSnapshot();
  const system = useSystem();
  const prices = useAmberPrices(now);
  const start = midnight(now);
  const { data: costs } = useQuery(costsQuery(start));
  const { data: history } = useQuery(
    historyQuery({ start, end: addDays(start, 1), points: 288, fields: FIELDS, live: true }),
  );
  // Today's weather as recorded, for the hours the forecast no longer covers.
  const { data: weatherToday } = useQuery(weatherDayQuery(dateKey(start)));
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
  return { forecast, accuracy, snapshot, system, history, weatherToday, rates, range, days, reserve, notes };
}

export type Plan = ReturnType<typeof usePlan>;

/**
 * The day a plan opens on when none is asked for: today while there's solar still worth planning around (a kWh or
 * more to come), else tomorrow.
 */
export function defaultDay(days: PlanDay[]): number {
  const today = days[0];
  return today && today.today && today.day.pv_kwh < 1 && days.length > 1 ? 1 : 0;
}

/** A day's best times to use power and its key moments. */
export function useDayPlan(plan: Plan, day: PlanDay | undefined, now: number) {
  const { rates, reserve } = plan;
  const times = useMemo(() => (day ? bestTimes(day.hours, rates) : null), [day, rates]);
  const events = useMemo(
    () => (day ? moments(day.hours, { now, end: addDays(day.start, 1), fullAt: day.battery.fullAt, reserve }) : []),
    [day, now, reserve],
  );
  return { times, events };
}
