/** The Bills page (GET /api/bills). Dates are local YYYY-MM-DD; money is AUD; a negative net cost is a credit. */

export type BillTotals = {
  import_kwh: number;
  export_kwh: number;
  home_kwh: number;
  import_cost: number;
  feed_in_credit: number;
  supply: number;
  net_cost: number;
  /** What the home's use would have cost from the grid alone, supply included. */
  without_solar: number;
};

/** What estimated days were based on: the same weeks last year, the last 30 days' average, or some of each. */
export type Basis = "last_year" | "recent" | "mixed" | null;

export type BillSpan = { start: string; end: string; days: number };

export type BillDay = {
  date: string;
  net_cost: number;
  import_kwh: number;
  export_kwh: number;
  pv_kwh: number | null;
  /** Today, still under way. */
  partial: boolean;
  /** Where import and export came from: imported smart-meter data, or the inverter. */
  source: "meter" | "inverter";
};

export type Bills = {
  generated_at: number;
  months: number;
  period: BillSpan & { day: number };
  current: {
    /** meter_days: how many of the days use imported smart-meter data rather than the inverter's figures. */
    so_far: BillTotals & { days: number; meter_days: number };
    expected: (BillTotals & { basis: Basis }) | null;
  };
  days: BillDay[];
  bands: { name: string; import_kwh: number; cost: number }[];
  past: (BillSpan & BillTotals & { recorded: number; meter_days: number })[];
  /** null where there isn't enough history to estimate that bill. */
  upcoming: ((BillSpan & BillTotals & { basis: Basis }) | null)[];
  next_year: { net_cost: number; without_solar: number } | null;
};
