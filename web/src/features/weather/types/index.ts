/** A day's weather hour by hour (GET /api/weather/day). Temperatures in °C, rain in mm, sunlight in W/m². */
export type WeatherHour = {
  ts: number; // start of the hour
  temp: number | null;
  cloud: number | null; // %
  code: number | null; // WMO weather code
  precip: number | null;
  precip_prob: number | null; // %
  wind: number | null; // km/h
  is_day: number | null;
  ghi: number | null;
  pv_forecast: number | null; // kWh the day-ahead forecast expected in the hour
};

export type WeatherDay = {
  date: string;
  hours: WeatherHour[];
  summary: {
    temp_min: number | null;
    temp_max: number | null;
    rain_mm: number | null;
    cloud: number | null; // % over daylight
    sunlight_kwh_m2: number | null;
    code: number | null;
    pv_forecast_kwh: number | null;
    source: "forecast" | "recent" | "archive" | null;
  };
};

export type Backtest = {
  days: number;
  learned_mae: number | null;
  simple_mae: number | null;
  learned_bias: number | null;
  simple_bias: number | null;
  actual_mean: number | null;
};

/** The weather integration's state (GET /api/weather). */
export type WeatherStatus = {
  enabled: boolean;
  model: string;
  model_unavailable: string | null;
  fetched_at: number | null;
  error: string | null;
  stored: { first_ts: number | null; last_ts: number | null; hours: number };
  missing_days: number;
  /** Filling in past weather: whether it's going, and its progress through this fill (`total` is null until counted). */
  backfill: {
    running: boolean;
    requested: boolean;
    refetch: boolean;
    total: number | null;
    done: number;
    started_at: number | null;
    finished_at: number | null;
    error: string | null;
    last_run: number | null;
    added_days: number;
    remaining: number;
  };
  /** The first day past weather can be filled in for (Open-Meteo's archive starts in 1940). */
  archive_from: string;
  /** Whether the location was chosen (past weather is only fetched once it is). */
  location_set: boolean;
  learning: {
    on: boolean;
    in_use: boolean;
    trained_at: number | null;
    days: number;
    first_day: string | null;
    better: boolean;
    min_days: number;
    backtest: (Backtest & { per_day?: { day: string; actual: number; learned: number; simple: number }[] }) | null;
  };
  accuracy: {
    days: { date: string; forecast_kwh: number; actual_kwh: number }[];
    mae_kwh: number | null;
    bias_kwh: number | null;
    actual_mean: number | null;
  };
};
