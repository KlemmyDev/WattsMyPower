import { useQuery } from "@tanstack/react-query";
import { pct } from "~/features/common/formatting/utils/number";
import { useLocationSet } from "~/features/common/settings/hooks";
import { useNow } from "~/features/common/time/hooks";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { solarInsightsQuery } from "~/features/solar/api";
import { SolarTrend } from "~/features/solar/components/SolarHealth";
import { PerformanceCauses } from "~/features/solar/components/sections/PerformanceCauses";
import { PerformanceDays } from "~/features/solar/components/sections/PerformanceDays";
import { PerformanceToday } from "~/features/solar/components/sections/PerformanceToday";
import { SolarSection } from "~/features/solar/components/sections/SolarSection";
import type { SolarInsights } from "~/features/solar/types";
import { averageRatio } from "~/features/solar/utils/forecastSections";

/** The page's live line: the 30 days' average against the weather, or what it's waiting on. */
function subOf(P: SolarInsights["performance"] | undefined, loading: boolean): string {
  if (loading) return "What your panels made against what the weather allowed";
  const avg = P && P.fitted_hours >= 24 ? averageRatio(P.days) : null;
  if (avg == null) return "Learning what your panels should make for the weather";
  return `30-day average ${pct(avg * 100)} of what the weather allowed`;
}

/**
 * Solar › Performance: what the panels made against what the weather allowed. The last 30 days and the year down the
 * left; what's holding them back and where today's sunlight went on the right (first on a phone, after the days).
 */
export function SolarPerformancePage() {
  const now = useNow(60_000);
  const located = useLocationSet();
  const { data, isPending } = useQuery(solarInsightsQuery);
  const P = data?.performance;
  return (
    <SolarSection section="performance" sub={subOf(P, isPending)}>
      {isPending ? (
        <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1">
          <Skeleton className="h-[340px] rounded-3xl" />
          <Skeleton className="h-[300px] rounded-3xl" />
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1">
          <div className="flex min-w-0 flex-col gap-5 max-3xl:contents">
            <div className="min-w-0 max-3xl:order-1">
              <PerformanceDays performance={P ?? null} located={located} />
            </div>
            {data && (
              <div className="min-w-0 max-3xl:order-4">
                <SolarTrend trend={data.trend} />
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-5 max-3xl:contents">
            <div className="min-w-0 max-3xl:order-2">
              <PerformanceCauses performance={P ?? null} located={located} />
            </div>
            {P && (
              <div className="min-w-0 empty:hidden max-3xl:order-3">
                <PerformanceToday performance={P} now={now} />
              </div>
            )}
          </div>
        </div>
      )}
    </SolarSection>
  );
}
