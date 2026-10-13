import { useQuery } from "@tanstack/react-query";
import { kWh } from "~/features/common/formatting/utils/number";
import { LocationPrompt } from "~/features/common/settings/components/LocationPrompt";
import { useLocationSet } from "~/features/common/settings/hooks";
import { useNow } from "~/features/common/time/hooks";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { useForecast, useForecastAccuracy } from "~/features/common/weather/hooks";
import type { ForecastAccuracy } from "~/features/common/weather/types";
import { solarInsightsQuery } from "~/features/solar/api";
import { ForecastClose } from "~/features/solar/components/sections/ForecastClose";
import { ForecastHours } from "~/features/solar/components/sections/ForecastHours";
import { ForecastMiss } from "~/features/solar/components/sections/ForecastMiss";
import { ForecastNext } from "~/features/solar/components/sections/ForecastNext";
import { ForecastSunlight } from "~/features/solar/components/sections/ForecastSunlight";
import { SolarSection } from "~/features/solar/components/sections/SolarSection";
import { useSolarDay } from "~/features/solar/hooks";
import { rollingMiss } from "~/features/solar/utils/forecastSections";
import { weatherStatusQuery } from "~/features/weather/api";

/**
 * The page's live line: the typical miss and whether it's closer than a month ago (the first week of the record
 * against the last), or what it's waiting on.
 */
function subOf(acc: ForecastAccuracy | null | undefined, located: boolean | undefined): string {
  if (located === false) return "Set your location to see the forecast";
  if (acc?.mae_kwh == null) return "The days ahead, and how close the forecast gets as it learns your roof";
  const runs = rollingMiss(acc);
  const typical = `Typically ${kWh(acc.mae_kwh)} off`;
  if (runs.length < 14) return typical;
  const was = runs[0].kwh;
  const is = runs[runs.length - 1].kwh;
  if (is < was * 0.9) return `${typical}, closer than a month ago`;
  if (is > was * 1.1) return `${typical}, further off than a month ago`;
  return `${typical}, about as close as a month ago`;
}

/**
 * Solar › Forecast: the days ahead and today hour by hour down the left with each day's miss; how close it gets (and
 * how much learning your roof helps) and sunlight against solar on the right. On a phone the days ahead lead.
 */
export function SolarForecastPage() {
  const now = useNow(60_000);
  const located = useLocationSet();
  const f = useForecast();
  const acc = useForecastAccuracy();
  const { series, weather } = useSolarDay(now);
  const { data: status } = useQuery(weatherStatusQuery);
  const { data: insights } = useQuery(solarInsightsQuery);
  const sub = subOf(acc, located);
  if (located === false)
    return (
      <SolarSection section="forecast" sub={sub}>
        <Card>
          <TitleBlock title="Forecast" sub="Solar the forecast expects, and how close it gets" />
          <LocationPrompt>The forecast needs to know where your panels are.</LocationPrompt>
        </Card>
      </SolarSection>
    );
  return (
    <SolarSection section="forecast" sub={sub}>
      <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-5 max-3xl:contents">
          <div className="min-w-0 empty:hidden max-3xl:order-1">
            {f === undefined ? (
              <Skeleton className="h-[360px] rounded-3xl" />
            ) : f ? (
              <ForecastNext f={f} acc={acc} now={now} />
            ) : (
              <Card>
                <TitleBlock title="Next days" />
                <div className="text-[13px] text-ink-faint">
                  The forecast is off or Open-Meteo can't be reached. Turn it on in Manage → Integrations → Weather.
                </div>
              </Card>
            )}
          </div>
          <div className="min-w-0 empty:hidden max-3xl:order-2">
            <ForecastHours weather={weather} series={series} now={now} />
          </div>
          <div className="min-w-0 empty:hidden max-3xl:order-4">{acc && <ForecastMiss acc={acc} />}</div>
        </div>
        <div className="flex min-w-0 flex-col gap-5 max-3xl:contents">
          <div className="min-w-0 empty:hidden max-3xl:order-3">
            {acc === undefined ? (
              <Skeleton className="h-[280px] rounded-3xl" />
            ) : (
              acc?.mae_kwh != null && <ForecastClose acc={acc} learning={status?.learning} />
            )}
          </div>
          <div className="min-w-0 empty:hidden max-3xl:order-5">
            {insights && <ForecastSunlight acc={acc} performance={insights.performance} now={now} />}
          </div>
        </div>
      </div>
    </SolarSection>
  );
}
