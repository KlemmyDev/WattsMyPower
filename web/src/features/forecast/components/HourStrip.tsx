import type { Forecast, ForecastHour } from "~/features/common/weather/types";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { hourLabel } from "~/features/common/formatting/utils/date";
import { pct } from "~/features/common/formatting/utils/number";
import { useFahrenheit } from "~/features/common/weather/hooks";
import { degrees, hourIcon } from "~/features/common/weather/utils";

/** The next 24 hours as columns: weather, temperature, a solar bar, its kWh, and battery level at the end of the hour. */
export function HourStrip({ forecast }: { forecast: Forecast }) {
  const hours = forecast.hours.slice(0, 24);
  // Bars are scaled to a full hour of sun for this system, or the sunniest hour if that's higher.
  const full = Math.max(forecast.calibration.kwh_per_kwh_m2, ...hours.map((h) => h.pv_kwh), 0.1);
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[1056px] grid-cols-[repeat(24,minmax(44px,1fr))]">
        {hours.map((h, i) => (
          <HourColumn key={h.ts} hour={h} first={i === 0} full={full} />
        ))}
      </div>
    </div>
  );
}

function HourColumn({ hour, first, full }: { hour: ForecastHour; first: boolean; full: number }) {
  const hr = new Date(hour.ts * 1000).getHours();
  const icon = hourIcon(hour);
  const fahrenheit = useFahrenheit();
  return (
    <div className={cn("flex flex-col items-center gap-2 rounded-xl py-3", hr === 0 && !first && "bg-canvas")}>
      <div className="text-[11px] font-semibold text-ink-muted tabular-nums">{first ? "Now" : hourLabel(hr)}</div>
      <div className={icon === "sun" ? "text-solar" : "text-ink-muted"}>
        <Icon name={icon} size={20} />
      </div>
      <div className="text-xs tabular-nums">{hour.temp != null ? degrees(hour.temp, fahrenheit) : "–"}</div>
      <div className="flex h-[120px] w-3.5 items-end rounded bg-canvas">
        <div className="w-full rounded bg-solar" style={{ height: `${Math.min(100, (hour.pv_kwh / full) * 100)}%` }} />
      </div>
      <div className="font-mono text-[11px] text-ink-faint tabular-nums">
        {hour.pv_kwh >= 0.05 ? hour.pv_kwh.toFixed(1) : "–"}
      </div>
      <div className="text-[11px] font-semibold text-brand tabular-nums">{pct(hour.soc)}</div>
    </div>
  );
}
