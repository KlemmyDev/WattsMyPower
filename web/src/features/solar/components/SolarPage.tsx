import { useQuery } from "@tanstack/react-query";
import { pct } from "~/features/common/formatting/utils/number";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import type { Snapshot } from "~/features/common/live/types";
import { COLOR } from "~/features/common/theme/utils/colors";
import { useNow } from "~/features/common/time/hooks";
import { Breakdown } from "~/features/common/ui/components/Breakdown";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { useForecast, useForecastAccuracy } from "~/features/common/weather/hooks";
import { solarInsightsQuery } from "~/features/solar/api";
import { SolarDays } from "~/features/solar/components/SolarDays";
import { SolarPerformance, SolarTrend } from "~/features/solar/components/SolarHealth";
import { SolarHero } from "~/features/solar/components/SolarHero";
import { SolarOutlook } from "~/features/solar/components/SolarOutlook";
import { SolarStrings } from "~/features/solar/components/SolarStrings";
import { useSolarDay } from "~/features/solar/hooks";

/**
 * Solar: what the panels are making now and through today against what the forecast expected; the last days, how
 * they're holding up and the days ahead; where today's went, each string, and the year.
 */
export function SolarPage() {
  const now = useNow(30_000);
  const p = useSnapshot();
  const s = useSystem();
  const f = useForecast();
  const acc = useForecastAccuracy();
  const { start, series, weather } = useSolarDay(now);
  const { data: insights } = useQuery(solarInsightsQuery);
  return (
    <>
      <PageHeader title="Solar" sub="What your panels are making against the forecast, and how they're holding up" />
      <div className="flex flex-col gap-5">
        <SolarHero p={p} s={s} f={f} acc={acc} series={series} weather={weather} start={start} now={now} />
        <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1">
          <div className="flex min-w-0 flex-col gap-5">
            <SolarDays acc={acc} performance={insights?.performance} now={now} />
            {insights ? (
              <SolarPerformance performance={insights.performance} />
            ) : (
              <Skeleton className="h-[300px] rounded-3xl" />
            )}
            <SolarOutlook f={f} acc={acc} now={now} />
          </div>
          <div className="flex min-w-0 flex-col gap-5">
            <WhereItWent p={p} />
            <SolarStrings p={p} s={s} />
            {insights && <SolarTrend trend={insights.trend} />}
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- where it went

/**
 * Where today's solar went: into the house, into the battery, or out to the grid. Export and charging can come from
 * elsewhere too (the battery to the grid, the grid to the battery), so each is capped at what solar could have given.
 */
export function WhereItWent({ p }: { p: Snapshot | null }) {
  const pv = p?.daily_pv ?? 0;
  const toGrid = Math.min(p?.daily_export ?? 0, pv);
  const toBattery = Math.min(p?.daily_charge ?? 0, pv - toGrid);
  const home = Math.max(0, pv - toGrid - toBattery);
  const parts = [
    { key: "home", label: "Used at home", kwh: home, color: COLOR.teal },
    { key: "battery", label: "Into the battery", kwh: toBattery, color: COLOR.battery },
    { key: "grid", label: "Sent to the grid", kwh: toGrid, color: COLOR.export },
  ];
  const kept = pv > 0 ? (home + toBattery) / pv : null;
  return (
    <Card>
      <div className="flex items-end justify-between gap-3">
        <TitleBlock title="Where it went" sub="Today's solar so far" />
        {kept != null && (
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-xs text-ink-faint">Kept at home</span>
            <span className="text-[28px] leading-8 font-light tracking-[-1px] tabular-nums">{pct(kept * 100)}</span>
          </div>
        )}
      </div>
      {pv > 0 ? (
        <Breakdown parts={parts} total={pv} />
      ) : (
        <div className="text-[13px] text-ink-faint">No solar yet today.</div>
      )}
    </Card>
  );
}
