/** Figures for the Health page (GET /api/insights) and its checkup (GET /api/insights/checkup). */
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

export type PerformanceDay = {
  date: string;
  actual_kwh: number | null;
  expected_kwh: number | null;
  ratio: number | null;
  clear: boolean;
};

/** What's likely holding solar back over the last 30 days (each null when there's no sign of it). */
export type Causes = {
  /** Output held at the system's limit on sunny hours. */
  capped: { limit_kw: number; days: number; kwh: number } | null;
  /** The latest rain after which clear-day output jumped (ratios of expected). */
  dust: { date: string; rain_mm: number; before: number; after: number } | null;
  /** A half of the day falling behind the other lately, against the weeks before. */
  shade: { part: "afternoon" | "morning"; drop: number } | null;
};

export type BatteryMonth = {
  month: string;
  soh: number | null;
  charge_kwh: number;
  discharge_kwh: number;
  efficiency: number | null;
  cycles: number | null;
};

export type Insights = {
  generated_at: number;
  last30: PeriodTotals;
  prev30: PeriodTotals;
  months: { month: string; days: number; self_pct: number | null }[];
  battery: { days: number; avg_swing: number | null; avg_full_min: number | null; months: BatteryMonth[] };
  performance: {
    fitted_hours: number;
    kwh_per_kwh_m2?: number;
    limit_kw?: number;
    days: PerformanceDay[];
    causes?: Causes;
  } | null;
  /** The performance ratio month by month over the last year, and its change per year (a share; − is a fall). */
  trend: { months: { month: string; ratio: number; hours: number }[]; per_year: number | null; pv_kw: number } | null;
  /** How the battery's size suits the house over the last 90 days, and what more storage would save. */
  sizing: {
    days: number;
    capacity_kwh: number;
    full_by_noon: number;
    reserve_days: number;
    sent_while_full_kwh: number;
    bought_while_low_kwh: number;
    options: { extra_kwh: number; kwh: number; saved: number | null; per_year: number | null }[];
  } | null;
  lifetime: {
    battery_kwh: number | null;
    soh: number | null;
    pv_kwh: number | null;
    charge_kwh: number | null;
    discharge_kwh: number | null;
    cycles: number | null;
    round_trip_pct: number | null;
  };
  /** How much of the battery's warranty is used (Settings → System), or null when none is set. */
  warranty: {
    installed: number | null;
    years: number | null;
    mwh: number | null;
    ends?: number;
    time_pct?: number;
    used_mwh?: number;
    energy_pct?: number;
  } | null;
};

export type CheckStatus = "ok" | "warn" | "bad" | "unknown";

export type Checkup = {
  checked_at: number;
  status: CheckStatus;
  items: { id: string; name: string; status: CheckStatus; summary: string; anchor: string }[];
};
