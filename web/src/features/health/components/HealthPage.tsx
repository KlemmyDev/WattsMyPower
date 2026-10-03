import { useQuery } from "@tanstack/react-query";
import { insightsQuery } from "~/features/health/api";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { BatteryHealth } from "~/features/health/components/BatteryHealth";
import { BatterySize } from "~/features/health/components/BatterySize";
import { Checkup } from "~/features/health/components/Checkup";
import { Kpis } from "~/features/health/components/Kpis";
import { MonthlySelfSufficiency } from "~/features/health/components/MonthlySelfSufficiency";
import { SolarPerformance } from "~/features/health/components/SolarPerformance";
import { SolarTrend } from "~/features/health/components/SolarTrend";

/**
 * Whether the system is working as it should: a checkup of each part first, then the panels (lately, with
 * likely causes, and over the year), the battery (its health, warranty, and whether it's the right size),
 * and self-sufficiency by month.
 */
export function HealthPage() {
  const { data, isError } = useQuery(insightsQuery);
  const system = useSystem();
  return (
    <>
      <PageHeader title="Health" sub="Whether your system is working as it should, and how it's holding up" />
      <Checkup />
      {data ? (
        <>
          <Kpis insights={data} system={system} />
          <SolarPerformance performance={data.performance} />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-start gap-5">
            <SolarTrend trend={data.trend} />
            <MonthlySelfSufficiency months={data.months} />
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-start gap-5">
            <BatteryHealth insights={data} system={system} />
            <BatterySize sizing={data.sizing} />
          </div>
        </>
      ) : // A failed refresh keeps showing the last figures; this only appears before the first load.
      isError ? (
        <div className="text-sm text-ink-faint">The figures could not be loaded. Try again shortly.</div>
      ) : (
        <div role="status" aria-label="Loading" className="flex flex-col gap-5">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-5">
            {[0, 1, 2].map((k) => (
              <Skeleton key={k} className="h-[150px] rounded-3xl" />
            ))}
          </div>
          <Skeleton className="h-[360px] rounded-3xl" />
        </div>
      )}
    </>
  );
}
