import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { kWh, pct } from "~/features/common/formatting/utils/number";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import type { Snapshot } from "~/features/common/live/types";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Breakdown } from "~/features/common/ui/components/Breakdown";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { exportCsvUrl } from "~/features/history/api";
import { useLiveDay, useLiveHero } from "~/features/live/hooks";
import { useForecast, useForecastAccuracy } from "~/features/common/weather/hooks";
import { solarInsightsQuery } from "~/features/solar/api";
import { SolarDays } from "~/features/solar/components/SolarDays";
import { SolarTrend } from "~/features/solar/components/SolarHealth";
import { SolarOutlook } from "~/features/solar/components/SolarOutlook";
import { useSolarHero } from "~/features/solar/components/SolarSky";
import { YourPanels } from "~/features/solar/components/YourPanels";
import { useSolarDay } from "~/features/solar/hooks";
import { pastDays } from "~/features/solar/utils";

/**
 * Solar, on one page: the sky as it is now over what the panels are making and how the day's going (scrub or play
 * through the day), in the top card the live pages share (its part is useSolarHero); the last days (with how the panels are doing against the weather) and the days ahead (with how
 * close the forecast gets); where today's went, the panels' inverters and strings, and the year; and today's readings
 * to download. Nothing is a level down: each card says what it's about in plain words.
 */
export function SolarPage() {
  const { now } = useLiveDay();
  const p = useSnapshot();
  const s = useSystem();
  const f = useForecast();
  const acc = useForecastAccuracy();
  const { start, series } = useSolarDay(now);
  const { data: insights } = useQuery(solarInsightsQuery);
  const past = pastDays(acc, insights?.performance, now);
  const usual = past.length >= 3 ? past.reduce((a, d) => a + d.kwh, 0) / past.length : null;
  useLiveHero(useSolarHero({ p, s, f, acc, series, usual }));
  const download = (
    <a
      href={exportCsvUrl(start, start + 86_400, true)}
      download
      className="flex min-h-10 items-center gap-2 self-start rounded-full border border-line bg-fg/4 px-4 text-sm text-ink-body no-underline transition-colors hover:bg-fg/8 hover:text-ink"
    >
      <Icon name="download" size={16} />
      Download today's readings
    </a>
  );
  return (
    <>
      <div className="live-cols grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-5">
          <SolarDays acc={acc} performance={insights?.performance} now={now} />
          <SolarOutlook f={f} acc={acc} now={now} />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <WhereItWent p={p} download={download} />
          <YourPanels p={p} s={s} now={now} />
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
export function WhereItWent({ p, download }: { p: Snapshot | null; download?: ReactNode }) {
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
      {download && <div className="-mt-2">{download}</div>}
      {pv > 0 ? (
        <Breakdown parts={parts} total={pv} onHover={setHover} />
      ) : (
        <div className="text-[13px] text-ink-faint">No solar yet today.</div>
      )}
    </Card>
  );
}
