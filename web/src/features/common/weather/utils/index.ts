import type { Forecast, ForecastHour } from "~/features/common/weather/types";
import type { Snapshot } from "~/features/common/live/types";
import type { IconName } from "~/features/common/ui/components/Icon";

// WMO weather codes (Open-Meteo).
const isRain = (c: number) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82);
export const isWet = (c: number) => isRain(c) || c >= 95;

export type SkyMode = "sunny" | "cloudy" | "rain" | "storm" | "night";
export type Cover = "clear" | "cloudy" | "rain" | "storm";
export type LiveWeather = { mode: SkyMode; cover?: Cover; label: string };

/** Icon for a forecast hour. */
export function hourIcon(h: ForecastHour): IconName {
  if (isWet(h.code)) return "rain";
  if (!h.is_day) return h.code >= 3 ? "cloud" : "moon";
  return h.code <= 1 ? "sun" : h.code === 2 ? "cloudSun" : "cloud";
}

/** Colour for an hour icon: amber sun, blue rain, grey otherwise. */
export const hourIconColor = (icon: IconName) => (icon === "sun" ? "#ffb547" : icon === "rain" ? "#9fb2ff" : "#9a9a9a");

/** The forecast hour containing `at`, if any. */
export const hourAt = (f: Forecast, at: number) => f.hours.find((x) => x.ts <= at && at < x.ts + 3600);

/** Sky and label from the forecast hour we're in now: sunny, cloudy, rain, storm, or night after dark. */
export function liveWeather(p: Snapshot, f: Forecast | null | undefined, now: number): LiveWeather {
  const h = f && (hourAt(f, now) || f.hours[0]);
  if (!h) return (p.pv_power || 0) > 100 ? { mode: "sunny", label: "Sunny" } : { mode: "night", label: "Night" };
  const c = h.code;
  const t = h.temp != null ? ` · ${Math.round(h.temp)}°` : "";
  const name =
    c >= 95
      ? "Thunderstorm"
      : c >= 80
        ? "Showers"
        : c >= 61
          ? "Rain"
          : c >= 51
            ? "Drizzle"
            : c >= 45
              ? "Fog"
              : c === 3
                ? "Overcast"
                : c === 2
                  ? "Partly cloudy"
                  : c === 1
                    ? "Mostly sunny"
                    : "Sunny";
  const cover: Cover = c >= 95 ? "storm" : isRain(c) ? "rain" : c >= 2 ? "cloudy" : "clear";
  if (!h.is_day) return { mode: "night", cover, label: (c <= 1 ? "Clear night" : c <= 3 ? "Cloudy night" : name) + t };
  return { mode: cover === "clear" ? "sunny" : cover, cover, label: name + t };
}

/** Icon for the live weather chip. */
export function liveWeatherIcon(w: LiveWeather): IconName {
  if (w.mode === "night")
    return ({ clear: "moon", cloudy: "cloud", rain: "rain", storm: "storm" } as const)[w.cover || "clear"];
  return ({ sunny: "sun", cloudy: "cloud", rain: "rain", storm: "storm" } as const)[w.mode];
}
