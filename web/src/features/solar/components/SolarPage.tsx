import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { kWh, pct } from "~/features/common/formatting/utils/number";
import { InverterNotice } from "~/features/common/layout/components/InverterNotice";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import type { Snapshot } from "~/features/common/live/types";
import { COLOR } from "~/features/common/theme/utils/colors";
import { useNow } from "~/features/common/time/hooks";
import { Breakdown } from "~/features/common/ui/components/Breakdown";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { useForecast, useForecastAccuracy } from "~/features/common/weather/hooks";
import { solarInsightsQuery } from "~/features/solar/api";
import { SolarDays } from "~/features/solar/components/SolarDays";
import { SolarTrend } from "~/features/solar/components/SolarHealth";
import { SolarHighlights } from "~/features/solar/components/SolarHighlights";
import { SolarOutlook } from "~/features/solar/components/SolarOutlook";
import { SolarSky } from "~/features/solar/components/SolarSky";
import { useSolarDay } from "~/features/solar/hooks";
import { pastDays, solarToday } from "~/features/solar/utils";

/**
 * Solar: the sky as it is now, with what the panels are making and how the day's going (scrub or play through the
 * day); four highlights that each lead into a section of their own; the last days and the days ahead; where today's
 * went and the year. The detail (strings and inverters, performance, the forecast, every reading) is a page a level
 * down, opened from the card it belongs to.
 */
export function SolarPage() {
  const now = useNow(30_000);
  const p = useSnapshot();
  const s = useSystem();
  const f = useForecast();
  const acc = useForecastAccuracy();
  const { start, series, weather } = useSolarDay(now);
  const { data: insights } = useQuery(solarInsightsQuery);
  const today = solarToday({ p, s, f, acc, series, weather, now });
  const past = pastDays(acc, insights?.performance, now);
  const usual = past.length >= 3 ? past.reduce((a, d) => a + d.kwh, 0) / past.length : null;
  return (
    <>
      <SolarSky p={p} s={s} f={f} acc={acc} series={series} weather={weather} start={start} now={now} usual={usual} />
      <InverterNotice />
      <SolarHighlights today={today} series={series} usual={usual} />
      <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-5">
          <SolarDays acc={acc} performance={insights?.performance} now={now} />
          <SolarOutlook f={f} acc={acc} now={now} />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <WhereItWent p={p} />
          {insights && <SolarTrend trend={insights.trend} />}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- where it went

/**
 * Where today's solar went: into the house, into the battery, or out to the grid. Export and charging can come from
 * elsewhere too (the battery to the grid, the grid to the battery), so each is capped at what solar could have given.
 * Pointing at a part puts it in the corner, where the share kept at home sits otherwise.
 */
export function WhereItWent({ p }: { p: Snapshot | null }) {
  const [hover, setHover] = useState<string | null>(null);
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
  const lit = parts.find((x) => x.key === hover);
  return (
    <Card>
      <div className="flex items-end justify-between gap-3">
        <TitleBlock title="Where it went" sub="Today's solar so far" />
        {lit ? (
          <div className="flex flex-col items-end gap-0.5" aria-live="polite">
            <span className="text-xs text-ink-faint">{lit.label}</span>
            <span className="text-[28px] leading-8 font-light tracking-[-1px] tabular-nums">{kWh(lit.kwh)}</span>
          </div>
        ) : (
          kept != null && (
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-xs text-ink-faint">Kept at home</span>
              <span className="text-[28px] leading-8 font-light tracking-[-1px] tabular-nums">{pct(kept * 100)}</span>
            </div>
          )
        )}
      </div>
      {pv > 0 ? (
        <Breakdown parts={parts} total={pv} onHover={setHover} />
      ) : (
        <div className="text-[13px] text-ink-faint">No solar yet today.</div>
      )}
    </Card>
  );
}
