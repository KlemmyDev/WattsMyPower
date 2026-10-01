import { useQuery } from "@tanstack/react-query";
import { insightsQuery } from "~/features/insights/api";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { BatteryHealth } from "~/features/insights/components/BatteryHealth";
import { GridHeatmap } from "~/features/insights/components/GridHeatmap";
import { Kpis } from "~/features/insights/components/Kpis";
import { MonthlySelfSufficiency } from "~/features/insights/components/MonthlySelfSufficiency";
import { SolarPerformance } from "~/features/insights/components/SolarPerformance";

export function InsightsPage() {
  const { data, isError } = useQuery(insightsQuery);
  const system = useSystem();
  return (
    <>
      <PageHeader title="Insights" sub="How well your system is performing, and where the grid still fills the gaps" />
      {data ? (
        <>
          <Kpis insights={data} system={system} />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-start gap-5">
            <MonthlySelfSufficiency months={data.months} />
            <BatteryHealth insights={data} system={system} />
          </div>
          <GridHeatmap months={data.months} system={system} />
          <SolarPerformance performance={data.performance} />
        </>
      ) : (
        // A failed refresh keeps showing the last insights; this only appears before the first load.
        <div className="text-sm text-ink-faint">
          {isError ? "Insights could not be loaded. Try again shortly." : "Loading insights"}
        </div>
      )}
    </>
  );
}
