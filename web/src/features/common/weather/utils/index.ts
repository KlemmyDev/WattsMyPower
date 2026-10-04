import type { Forecast, ForecastHour } from "~/features/common/weather/types";
import type { Snapshot } from "~/features/common/live/types";
import type { IconName } from "~/features/common/ui/components/Icon";
import { COLOR } from "~/features/common/theme/utils/colors";

// WMO weather codes (Open-Meteo).
const isRain = (c: number) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82);
export const isWet = (c: number) => isRain(c) || c >= 95;

export type SkyMode = "sunny" | "cloudy" | "rain" | "storm" | "night";
export type Cover = "clear" | "cloudy" | "rain" | "storm";
export type LiveWeather = { mode: SkyMode; cover?: Cover; label: string };

/** A temperature from °C, rounded, in the unit chosen in Settings: "22°". */
export const degrees = (celsius: number, fahrenheit: boolean) =>
  `${Math.round(fahrenheit ? (celsius * 9) / 5 + 32 : celsius)}°`;

/** What a WMO weather code means, in a word or two. */
export function codeName(c: number): string {
  if (c >= 95) return "Thunderstorm";
  if (c >= 80) return "Showers";
  if (c >= 71) return "Snow";
  if (c >= 61) return "Rain";
  if (c >= 51) return "Drizzle";
  if (c >= 45) return "Fog";
  return ["Sunny", "Mostly sunny", "Partly cloudy", "Overcast"][c] ?? "Overcast";
}

/** Icon for a weather code, by day or night. */
export function codeIcon(code: number, isDay: boolean): IconName {
  if (code >= 95) return "storm";
  if (isWet(code)) return "rain";
  if (!isDay) return code >= 3 ? "cloud" : "moon";
  return code <= 1 ? "sun" : code === 2 ? "cloudSun" : "cloud";
}

/** Icon for a forecast hour. */
export function hourIcon(h: Pick<ForecastHour, "code" | "is_day">): IconName {
  if (isWet(h.code)) return "rain";
  if (!h.is_day) return h.code >= 3 ? "cloud" : "moon";
  return h.code <= 1 ? "sun" : h.code === 2 ? "cloudSun" : "cloud";
}

/** Colour for an hour icon: amber sun, blue rain, grey otherwise. */
export const hourIconColor = (icon: IconName) =>
  icon === "sun" ? COLOR.solar : icon === "rain" ? COLOR.link : COLOR.inkMuted;

/** The forecast hour containing `at`, if any. */
export const hourAt = (f: Forecast, at: number) => f.hours.find((x) => x.ts <= at && at < x.ts + 3600);

/** Sky and label from the forecast hour we're in now: sunny, cloudy, rain, storm, or night after dark. */
export function liveWeather(p: Snapshot, f: Forecast | null | undefined, now: number, fahrenheit = false): LiveWeather {
  const h = f && (hourAt(f, now) || f.hours[0]);
  if (!h) return (p.pv_power || 0) > 100 ? { mode: "sunny", label: "Sunny" } : { mode: "night", label: "Night" };
  const c = h.code;
  const t = h.temp != null ? ` · ${degrees(h.temp, fahrenheit)}` : "";
  const name = codeName(c);
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
