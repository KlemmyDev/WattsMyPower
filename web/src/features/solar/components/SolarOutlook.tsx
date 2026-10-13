import { parseYmd, shortDay } from "~/features/common/formatting/utils/date";
import { DASH, kWh } from "~/features/common/formatting/utils/number";
import { LocationPrompt } from "~/features/common/settings/components/LocationPrompt";
import { useLocationSet } from "~/features/common/settings/hooks";
import { alpha } from "~/features/common/theme/utils/colors";
import { useBarHover } from "~/features/common/ui/components/ChartHover";
import { dateKey } from "~/features/common/time/utils";
import { Card, Footnote, TitleBlock } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { useFahrenheit } from "~/features/common/weather/hooks";
import type { Forecast, ForecastAccuracy } from "~/features/common/weather/types";
import { codeIcon, codeName, degrees } from "~/features/common/weather/utils";
import { SOLAR } from "~/features/solar/components/parts";
import { SectionLink } from "~/features/solar/components/sections/SolarSection";

const TH = "pb-2 text-left text-[11.5px] font-normal text-ink-faint";
const TD = "border-t border-line-subtle py-2.5 text-[13px] tabular-nums";

/**
 * The rest of today and the next two days, a line each: the sky, the sunlight expected, the solar the forecast
 * expects and the range it usually lands in. Pointing at a day puts its likely range in the corner, where tomorrow's
 * sits otherwise.
 */
export function SolarOutlook({
  f,
  acc,
  now,
}: {
  f: Forecast | null | undefined;
  acc: ForecastAccuracy | null | undefined;
  now: number;
}) {
  const fahrenheit = useFahrenheit();
  const located = useLocationSet();
  const range = acc?.range;
  const { hover, plot, bar } = useBarHover<string>();
  const title = (
    <TitleBlock
      title={
        <span className="flex items-baseline gap-3">
          Days ahead
          <SectionLink to="forecast">Forecast</SectionLink>
        </span>
      }
      sub="Solar the forecast expects, today and the next two days"
    />
  );
  if (located === false)
    return (
      <Card className="h-full">
        {title}
        <LocationPrompt>The forecast needs to know where your panels are.</LocationPrompt>
      </Card>
    );
  if (!f) return null;
  const top = Math.max(0.1, ...f.days.map((d) => d.pv_kwh * (range?.high ?? 1)));
  const shown = f.days.find((d) => d.date === hover) ?? f.days.find((d) => d.date !== dateKey(now)) ?? f.days[0];
  const dayName = (date: string) => (date === dateKey(now) ? "Rest of today" : shortDay.format(parseYmd(date)));
  return (
    <Card className="h-full gap-4">
      <div className="flex items-end justify-between gap-3" aria-live="polite">
        {title}
        {shown && (
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <span className="text-xs text-ink-faint">{dayName(shown.date)}</span>
            <span className="text-[28px] leading-8 font-light tracking-[-1px] tabular-nums">{kWh(shown.pv_kwh)}</span>
            {range && (
              <span className="text-[11.5px] text-ink-faint tabular-nums">
                Likely {(shown.pv_kwh * range.low).toFixed(1)} to {kWh(shown.pv_kwh * range.high)}
              </span>
            )}
          </div>
        )}
      </div>
      <table className="w-full border-collapse" {...plot}>
        <thead>
          <tr>
            <th className={TH}>Day</th>
            <th className={TH}>Sky</th>
            <th className={cn(TH, "text-right")}>Sunlight</th>
            <th className={cn(TH, "pl-4 max-sm:hidden")}>
              <span className="sr-only">Range</span>
            </th>
            <th className={cn(TH, "text-right")}>Solar</th>
          </tr>
        </thead>
        <tbody>
          {f.days.map((d) => {
            const lo = range ? d.pv_kwh * range.low : null;
            const hi = range ? d.pv_kwh * range.high : null;
            return (
              <tr
                key={d.date}
                tabIndex={0}
                {...bar(d.date)}
                className={cn(
                  "cursor-default transition-opacity duration-200 outline-none",
                  hover != null && hover !== d.date && "opacity-35",
                )}
              >
                <td className={cn(TD, "whitespace-nowrap")}>{dayName(d.date)}</td>
                <td className={cn(TD, "text-ink-muted")}>
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    {d.code != null && <Icon name={codeIcon(d.code, true)} size={15} className="flex-none" />}
                    <span className="max-md:hidden">{d.code != null ? codeName(d.code) : ""}</span>
                    {d.temp_max != null && <span className="text-ink-faint">{degrees(d.temp_max, fahrenheit)}</span>}
                  </span>
                </td>
                <td className={cn(TD, "text-right text-ink-muted")}>
                  {d.sun_kwh_m2 != null ? d.sun_kwh_m2.toFixed(1) : DASH}
                </td>
                <td className={cn(TD, "w-[28%] pr-5 pl-4 max-sm:hidden")}>
                  <span className="relative block h-1.5 rounded-full bg-track">
                    {lo != null && hi != null && (
                      <span
                        className="absolute inset-y-0 rounded-full"
                        style={{
                          left: `${(lo / top) * 100}%`,
                          width: `${((hi - lo) / top) * 100}%`,
                          background: alpha(SOLAR, 0.3),
                        }}
                      />
                    )}
                    <span
                      className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                      style={{ left: `${(d.pv_kwh / top) * 100}%`, background: SOLAR }}
                    />
                  </span>
                </td>
                <td className={cn(TD, "text-right font-medium whitespace-nowrap")}>{kWh(d.pv_kwh)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Footnote>
        {range
          ? `Sunlight is kWh/m² on flat ground. The shaded range is where 8 in 10 of the last ${range.days} days landed against their forecast.`
          : "Sunlight is kWh/m² on flat ground."}
      </Footnote>
    </Card>
  );
}
