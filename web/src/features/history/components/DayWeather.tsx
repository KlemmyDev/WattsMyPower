import { useQuery } from "@tanstack/react-query";
import { kWh } from "~/features/common/formatting/utils/number";
import { hourLabel } from "~/features/common/formatting/utils/date";
import { Icon } from "~/features/common/ui/components/Icon";
import { useFahrenheit } from "~/features/common/weather/hooks";
import { codeIcon, codeName, degrees, hourIconColor } from "~/features/common/weather/utils";
import { weatherDayQuery } from "~/features/weather/api";

/** A past day's weather in a word and its temperature range, next to its numbers. */
export function DayWeatherChip({ date }: { date: string }) {
  const { data } = useQuery(weatherDayQuery(date));
  const fahrenheit = useFahrenheit();
  const s = data?.summary;
  if (!s || s.code == null) return null;
  const range =
    s.temp_min != null && s.temp_max != null
      ? ` · ${degrees(s.temp_min, fahrenheit).slice(0, -1)}–${degrees(s.temp_max, fahrenheit)}`
      : "";
  return (
    <div className="flex items-center gap-2 rounded-full bg-surface-raised py-1.5 pr-3 pl-2 text-[13px] text-ink-soft">
      <span style={{ color: hourIconColor(codeIcon(s.code, true)) }}>
        <Icon name={codeIcon(s.code, true)} size={16} />
      </span>
      {codeName(s.code)}
      {range}
    </div>
  );
}

/**
 * The day's weather under its chart: every third hour's sky and temperature, then the rain, cloud and sunshine,
 * and what the forecast expected the day before against what the panels made.
 */
export function DayWeather({ date, made }: { date: string; made: number | null }) {
  const { data } = useQuery(weatherDayQuery(date));
  const fahrenheit = useFahrenheit();
  if (!data?.hours.length) return null;
  const s = data.summary;
  const every3 = data.hours.filter((h) => new Date(h.ts * 1000).getHours() % 3 === 0);
  const facts = [
    s.rain_mm != null && s.rain_mm >= 0.1 ? `${s.rain_mm} mm of rain` : "No rain",
    s.cloud != null && `${s.cloud}% cloud through the day`,
    s.sunlight_kwh_m2 != null && `${s.sunlight_kwh_m2.toFixed(1)} kWh/m² of sunshine`,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-3 border-t border-line-subtle pt-4">
      <div className="grid grid-cols-8" aria-label="Weather through the day">
        {every3.map((h) => {
          const icon = codeIcon(h.code ?? 0, !!h.is_day);
          return (
            <div key={h.ts} className="flex flex-col items-center gap-1">
              <span className="text-[11px] text-ink-faint tabular-nums">
                {hourLabel(new Date(h.ts * 1000).getHours())}
              </span>
              <span style={{ color: hourIconColor(icon) }} title={h.code != null ? codeName(h.code) : undefined}>
                <Icon name={icon} size={18} />
              </span>
              <span className="text-xs text-ink-soft tabular-nums">
                {h.temp != null ? degrees(h.temp, fahrenheit) : "–"}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-muted">
        {facts.map((f) => (
          <span key={String(f)}>{f}</span>
        ))}
        {s.pv_forecast_kwh != null && (
          <span>
            Forecast the day before: {kWh(s.pv_forecast_kwh)}
            {made != null && ` (made ${kWh(made)})`}
          </span>
        )}
      </div>
    </div>
  );
}
