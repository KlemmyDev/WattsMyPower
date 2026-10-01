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

export type Forecast = {
  generated_at: number;
  calibration: { kwh_per_kwh_m2: number; fitted_hours: number };
  hours: ForecastHour[];
  summary: {
    pv_kwh_24h: number;
    full_at: number | null;
    min_soc_tonight: number | null;
    tomorrow_morning: string;
  };
};
