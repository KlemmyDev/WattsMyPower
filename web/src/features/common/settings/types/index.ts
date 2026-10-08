/** Settings editable from the dashboard (GET/PUT /api/settings). */
export type Settings = {
  latitude: number;
  longitude: number;
  /** The billing period: every 1, 2 or 3 months from this day of the month (1-28), in step with a month (1-12) a bill starts in. */
  bill_months: number;
  bill_day: number;
  bill_anchor: number;
  /**
   * What comes off each bill (Settings → Bills): the retailer's discount (%) off usage, or off usage and the supply
   * charge; credits a year in dollars (concessions, government rebates), spread over the days; and a budget a bill in
   * dollars, for the Bills page and its alert. 0 = none.
   */
  bill_discount_pct: number;
  bill_discount_on: "usage" | "usage_supply";
  bill_credits_year: number;
  bill_budget: number;
  /** What's always on should come down to, W (a goal on the Home page). 0 = none. */
  home_standby_goal: number;
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
  /** Ask GitHub every few hours whether there's a newer version (1), or not (0) (Settings → System → Updates). */
  update_check: number;
  /**
   * The house as the Overview draws it (Settings → System → Your house): its style; 1 or 2 storeys; car spaces in the garage
   * (0 = no garage); and where each inverter and battery is, in the order they're connected (missing = outside).
   */
  house_style: "estate" | "modern" | "queenslander" | "federation" | "farmhouse";
  house_storeys: number;
  garage_spaces: number;
  inverter_places: ("wall" | "garage")[];
  battery_places: ("wall" | "garage")[];
  /**
   * Cost and warranty (Settings → System): what the system cost in dollars, and when it went in, for payback on Bills;
   * when the battery went in if later, and its warranty in years and in MWh delivered, for Health. 0 = not set. Dates
   * are unix seconds at local midnight.
   */
  system_cost: number;
  system_installed: number;
  battery_installed: number;
  battery_warranty_years: number;
  battery_warranty_mwh: number;
};

/** Settings a bill's dates and total depend on. */
export const BILL_SETTINGS: (keyof Settings)[] = [
  "bill_months",
  "bill_day",
  "bill_anchor",
  "bill_discount_pct",
  "bill_discount_on",
  "bill_credits_year",
  "bill_budget",
];

export type OwnershipKey =
  "system_cost" | "system_installed" | "battery_installed" | "battery_warranty_years" | "battery_warranty_mwh";

export const OWNERSHIP_SETTINGS: OwnershipKey[] = [
  "system_cost",
  "system_installed",
  "battery_installed",
  "battery_warranty_years",
  "battery_warranty_mwh",
];

export type WeatherModel = "best_match" | "ecmwf_ifs025" | "gfs_seamless" | "icon_seamless";

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
