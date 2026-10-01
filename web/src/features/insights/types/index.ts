/** Figures for the Insights page (GET /api/insights). */
export type HeatCell = { kwh: number; soc: number | null } | null;

export type PeriodTotals = {
  days: number;
  pv: number;
  imp: number;
  exp: number;
  chg: number;
  dis: number;
  home: number;
  pv_home: number;
  self_pct: number | null;
  pv_home_pct: number | null;
};

export type Insights = {
  generated_at: number;
  co2_kg_per_kwh: number;
  last30: PeriodTotals;
  prev30: PeriodTotals;
  months: { month: string; days: number; self_pct: number | null; heat: HeatCell[] | null }[];
  battery: { days: number; avg_swing: number | null; avg_full_min: number | null };
  performance: {
    fitted_hours: number;
    kwh_per_kwh_m2: number;
    limit_kw: number;
    days: {
      date: string;
      actual_kwh: number | null;
      expected_kwh: number | null;
      ratio: number | null;
      clear: boolean;
    }[];
  } | null;
  lifetime: {
    battery_kwh: number | null;
    soh: number | null;
    pv_kwh: number | null;
    charge_kwh: number | null;
    discharge_kwh: number | null;
    cycles: number | null;
    round_trip_pct: number | null;
    co2_t: number | null;
  };
};
