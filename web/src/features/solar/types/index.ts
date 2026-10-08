/** The solar figures from GET /api/insights (the Battery page reads the same response for its own). */
export type PerformanceDay = {
  date: string;
  actual_kwh: number | null;
  expected_kwh: number | null;
  ratio: number | null;
  clear: boolean;
};

/** What's likely holding solar back over the last 30 days (each null when there's no sign of it). */
export type Causes = {
  /** Output held at the inverter's limit on sunny hours. */
  capped: { limit_kw: number; days: number; kwh: number } | null;
  /** The latest rain after which clear-day output jumped (ratios of expected). */
  dust: { date: string; rain_mm: number; before: number; after: number } | null;
  /** A half of the day falling behind the other lately, against the weeks before. */
  shade: { part: "afternoon" | "morning"; drop: number } | null;
};

export type SolarInsights = {
  generated_at: number;
  performance: {
    fitted_hours: number;
    kwh_per_kwh_m2?: number;
    limit_kw?: number;
    days: PerformanceDay[];
    causes?: Causes;
  } | null;
  /** The performance ratio month by month over the last year, and its change per year (a share; − is a fall). */
  trend: { months: { month: string; ratio: number; hours: number }[]; per_year: number | null; pv_kw: number } | null;
  lifetime: { pv_kwh: number | null };
};
