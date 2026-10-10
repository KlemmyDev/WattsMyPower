/** The battery's figures from GET /api/insights: its health, cycles and warranty, and whether its size suits. */

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
  /** The last 30 days: how many have readings, and what the battery discharged over them (kWh). */
  last30: { days: number; dis: number };
  battery: { days: number; avg_swing: number | null; avg_full_min: number | null; months: BatteryMonth[] };
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
    discharge_kwh: number | null;
    cycles: number | null;
    round_trip_pct: number | null;
  };
  /** How much of the battery's warranty is used (Settings), or null when none is set. */
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
