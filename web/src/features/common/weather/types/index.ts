/** The solar and battery forecast (GET /api/forecast). */
export type ForecastHour = {
  ts: number; // start of the hour
  start: number; // max(ts, now) for the current hour
  pv_kwh: number;
  pv_kw: number;
  load_kw: number;
  soc: number; // % at the end of the hour
  grid_kwh: number; // + import, − export
  temp: number | null;
  code: number; // WMO weather code
  is_day: number;
  precip: number;
};

/** One day of the outlook: today from now on, then the next two days whole. */
export type ForecastDay = {
  date: string; // YYYY-MM-DD, local
  start: number; // local midnight
  from: number; // when its forecast starts: now for today, midnight otherwise
  pv_kwh: number;
  load_kwh: number;
  /** Sunlight on flat ground over the day's forecast hours (kWh/m²). */
  sun_kwh_m2?: number;
  import_kwh: number;
  export_kwh: number;
  full_at: number | null; // when the battery is forecast to reach full that day
  full_now: boolean; // today only: it's full already
  max_soc: number;
  min_soc: number;
  code: number | null; // WMO code summing up its daylight hours
  temp_min: number | null;
  temp_max: number | null;
  precip: number; // highest chance of rain in daylight, %
};

/** How close the day-ahead solar forecast has come (GET /api/forecast/accuracy). */
export type ForecastAccuracy = {
  days: { date: string; forecast_kwh: number; actual_kwh: number }[];
  mae_kwh: number | null;
  bias_kwh: number | null;
  actual_mean: number | null;
  /** Actual solar over forecast on 8 in 10 days: forecast × low to forecast × high. Null until a week of days. */
  range: { low: number; high: number; days: number } | null;
};

/** When the weather was last fetched from Open-Meteo and when it's next due (unix seconds), every `every` seconds. */
export type WeatherTiming = { fetched_at: number | null; next_at: number | null; every: number; error: string | null };

export type Forecast = {
  generated_at: number;
  weather?: WeatherTiming;
  calibration: { kwh_per_kwh_m2: number; fitted_hours: number };
  /** Which solar model made it: the plain one, or the one learned from weather history (with how it back-tested). */
  model?: {
    kind: "learned" | "simple";
    days: number;
    backtest: { days: number; learned_mae: number | null; simple_mae: number | null };
  };
  hours: ForecastHour[];
  /** Today and the next two days, summed up. */
  days: ForecastDay[];
  /**
   * What the home-use forecast comes from: the last `window_days` days' home use (whole days only), how many hours
   * of its typical day come from the readings (the others are a rough default), and that typical day in kWh.
   */
  load_basis?: {
    window_days: number;
    days: { date: string; kwh: number }[];
    hours_known: number;
    typical_kwh: number;
    /** The typical day hour by hour (kW, from midnight): also what today's hours gone were forecast to use. */
    profile_kw?: number[];
  };
  summary: {
    pv_kwh_24h: number;
    full_at: number | null;
    min_soc_tonight: number | null;
    tomorrow_morning: string;
  };
};
