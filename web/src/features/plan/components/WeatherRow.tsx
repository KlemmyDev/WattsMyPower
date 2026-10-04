import { hourLabel } from "~/features/common/formatting/utils/date";
import { Icon } from "~/features/common/ui/components/Icon";
import { useFahrenheit } from "~/features/common/weather/hooks";
import { degrees, hourIcon, hourIconColor } from "~/features/common/weather/utils";

/** An hour's weather: from the forecast, or as recorded. */
export type Sky = { ts: number; temp: number | null; code: number | null; is_day: number | null };

/** A day's weather every three hours (00:00 to 21:00), from the hour in the middle of each: whichever list has it first. */
export function skyEvery3h(start: number, ...sources: (Sky[] | undefined)[]): (Sky | null)[] {
  return Array.from({ length: 8 }, (_, k) => {
    const t = start + (k * 3 + 1) * 3600;
    for (const list of sources) {
      const h = list?.find((x) => x.ts === t);
      if (h) return h;
    }
    return null;
  });
}

/**
 * The weather across the top of a day's chart: an icon and temperature for each three hours, in eight columns that
 * line up with a chart spanning midnight to midnight.
 */
export function WeatherRow({ sky }: { sky: (Sky | null)[] }) {
  const fahrenheit = useFahrenheit();
  return (
    <div className="grid grid-cols-8" aria-label="Weather every three hours">
      {sky.map((h, k) => {
        const icon = h?.code != null ? hourIcon({ code: h.code, is_day: h.is_day ?? 1 }) : null;
        return (
          <div key={k} title={hourLabel(k * 3 + 1)} className="flex flex-col items-center gap-1">
            <span style={{ color: icon ? hourIconColor(icon) : undefined }} className="flex h-[18px] items-center">
              {icon ? <Icon name={icon} size={18} /> : <span className="text-xs text-ink-faint">–</span>}
            </span>
            <span className="text-xs text-ink-soft tabular-nums">
              {h?.temp != null ? degrees(h.temp, fahrenheit) : "–"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
