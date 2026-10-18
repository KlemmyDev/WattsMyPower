import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { kWh, pct } from "~/features/common/formatting/utils/number";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import type { Snapshot } from "~/features/common/live/types";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { dim, usePick } from "~/features/common/ui/components/Pick";
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
import { cn } from "~/features/common/ui/utils";

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
      className="flex items-center gap-1.5 rounded-full border border-line bg-fg/4 px-2.5 py-1 text-xs text-ink-body no-underline transition-colors hover:bg-fg/8 hover:text-ink"
    >
      <Icon name="download" size={13} />
      Download readings
    </a>
  );
  return (
    <>
      <div className="live-cols grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-5 max-3xl:contents">
          <SolarDays acc={acc} performance={insights?.performance} now={now} />
          <SolarOutlook f={f} acc={acc} now={now} />
          {insights && <SolarTrend trend={insights.trend} />}
        </div>
        <div className="flex min-w-0 flex-col gap-5 max-3xl:contents">
          <div className="min-w-0 max-3xl:order-first">
            <WhereItWent p={p} download={download} />
          </div>
          <YourPanels p={p} s={s} now={now} />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- where it went

/**
 * Where today's solar went: into the house, into the battery, or out to the grid. Export and charging can come from
 * elsewhere too (the battery to the grid, the grid to the battery), so each is capped at what solar could have given.
 * Pointing at a part, or choosing it, puts it in the corner, where the share kept at home sits otherwise; a chosen
 * part stays lit until another is chosen.
 */
export function WhereItWent({ p, download }: { p: Snapshot | null; download?: ReactNode }) {
  const { picked, plot, item } = usePick<string>();
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
  const lit = parts.find((x) => x.key === picked);
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <TitleBlock title="Where it went" sub="Today's solar so far" />
        <div className="flex flex-col items-end gap-2">
          {download}
          {lit ? (
            <div className="flex flex-col items-end gap-0.5" aria-live="polite">
              <span className="text-xs text-ink-faint">{lit.label}</span>
              <span className="text-[28px] leading-8 font-light tracking-[-1px] tabular-nums">{kWh(lit.kwh)}</span>
            </div>
          ) : (
            kept != null && (
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-xs text-ink-faint">Solar share</span>
                <span className="text-[28px] leading-8 font-light tracking-[-1px] tabular-nums">{pct(kept * 100)}</span>
              </div>
            )
          )}
        </div>
      </div>
      {pv > 0 ? (
        <div className="flex items-end gap-3" {...plot}>
          {parts.map((x) => (
            <button
              key={x.key}
              type="button"
              {...item(x.key)}
              aria-label={`${x.label}: ${kWh(x.kwh)}`}
              className={cn(
                "flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-1.5 border-0 bg-transparent p-0",
                dim(picked, x.key),
              )}
            >
              <span className="text-sm font-medium tabular-nums">{kWh(x.kwh)}</span>
              <span
                className="block w-full rounded-t-md"
                style={{ height: `${Math.max(4, (x.kwh / pv) * 120)}px`, background: x.color }}
              />
              <span className="text-xs text-ink-muted">{x.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="text-[13px] text-ink-faint">No solar yet today.</div>
      )}
    </Card>
  );
}
