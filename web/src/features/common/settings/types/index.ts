/** Settings editable from the dashboard (GET/PUT /api/settings). */
export type Settings = {
  latitude: number;
  longitude: number;
  /** The billing period: every 1, 2 or 3 months from this day of the month (1-28), in step with a month (1-12) a bill starts in. */
  bill_months: number;
  bill_day: number;
  bill_anchor: number;
  location_name: string | null;
  /**
   * What the inverter can't report (Settings → System): the array size in kW, the battery's capacity in kWh
   * (0 = what the inverter reports), the reserve (%) used when the inverter doesn't report one, and its maximum rate in kW.
   */
  pv_kw: number;
  battery_kwh_override: number;
  battery_reserve_fallback: number;
  battery_max_kw: number;
  /**
   * Weather (Settings → Integrations → Weather): temperatures in °F (1) or °C (0); Open-Meteo's weather model; how the
   * panels sit (tilt from flat, 0 = flat or not known, and the compass bearing they face, 0 = north); and whether the
   * forecast may use what it has learned from weather history (1).
   */
  temp_unit_f: number;
  weather_model: WeatherModel;
  panel_tilt: number;
  panel_bearing: number;
  forecast_learning: number;
};

export type WeatherModel = "best_match" | "bom_access_global" | "ecmwf_ifs025" | "gfs_seamless" | "icon_seamless";

/** Settings the weather is fetched for, or the forecast's solar depends on. */
export const WEATHER_SETTINGS: (keyof Settings)[] = [
  "latitude",
  "longitude",
  "weather_model",
  "panel_tilt",
  "panel_bearing",
  "pv_kw",
  "forecast_learning",
];

export type SystemSettingKey = "pv_kw" | "battery_kwh_override" | "battery_reserve_fallback" | "battery_max_kw";

export const SYSTEM_SETTINGS: SystemSettingKey[] = [
  "pv_kw",
  "battery_kwh_override",
  "battery_reserve_fallback",
  "battery_max_kw",
];
