/**
 * The Bills page (GET /api/bills). Dates are local YYYY-MM-DD; money is AUD; a negative net cost is a credit. A bill's
 * net cost is after its discount and credits; each day's is at the rates alone.
 */

export type BillTotals = {
  import_kwh: number;
  export_kwh: number;
  home_kwh: number;
  import_cost: number;
  feed_in_credit: number;
  supply: number;
  net_cost: number;
  /** What comes off the bill (Settings → Bills): the retailer's discount, and credits such as concessions. */
  discount: number;
  credits: number;
  /** What the home's use would have cost from the grid alone, supply included, less the same discount and credits. */
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
  home_kwh: number;
  pv_kwh: number | null;
  import_cost: number;
  feed_in_credit: number;
  supply: number;
  /** Grid use and its cost in each rate, in the order of `Bills.bands`. */
  bands: { import_kwh: number; cost: number }[];
  /** Today, still under way. */
  partial: boolean;
  /** Where import and export came from: imported smart-meter data, or the inverter. */
  source: "meter" | "inverter";
};

/**
 * A way to lower the bill, worked out from the last 30 days at today's rates. `saving` is roughly what
 * it's worth over a whole bill ($), or null where it can't be put in dollars. Rates are $/kWh.
 */
export type BillTip =
  | {
      kind: "peak";
      saving: number;
      /** Index of the dearest rate the grid is used in. */
      band: number;
      kwh_day: number;
      rate: number;
      /** "solar" (exported solar), or the name of the rate to move use into. */
      to: string;
      to_rate: number;
      moved_kwh_day: number;
    }
  | {
      kind: "solar";
      saving: number;
      export_kwh_day: number;
      feed_in: number;
      import_price: number;
      moved_kwh_day: number;
    }
  | {
      kind: "baseload";
      saving: number;
      watts: number;
      kwh_day: number;
      /** What it costs over a bill, at `price` a kWh. */
      cost: number;
      cut_watts: number;
      /** The night rate for what came from the grid, and the feed-in rate for what the battery covered. */
      price: number;
      /** Of overnight use, the share from the grid (0 to 1). */
      grid_share: number;
      night_rate: number;
    }
  | { kind: "supply"; saving: null; share: number; cost: number; per_day: number };

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
  /** The rest of this period, from tomorrow: what each day is expected to cost. */
  ahead: { date: string; net_cost: number }[];
  bands: { name: string; import_kwh: number; cost: number }[];
  /** Ways to lower the bill, most valuable first. */
  tips: BillTip[];
  past: (BillSpan & BillTotals & { recorded: number; meter_days: number })[];
  /** null where there isn't enough history to estimate that bill. */
  upcoming: ((BillSpan & BillTotals & { basis: Basis }) | null)[];
  next_year: { net_cost: number; without_solar: number } | null;
  /** The budget a bill set in Settings → Bills ($), or null with none. */
  budget: number | null;
};

/** Grid use by hour of the day (GET /api/bills/grid-hours): per day on average, each month. */
export type GridHours = {
  type: "flat" | "tou" | "amber";
  months: { month: string; hours: ({ kwh: number; cost: number } | null)[] | null }[];
  /** On time of use: the dearest band and the hours of a weekday it covers. */
  dearest: { name: string; hours: number[] } | null;
};

/** What the system has saved and when it pays for itself (GET /api/bills/payback). */
export type Payback = {
  cost: number | null;
  installed: number | null;
  co2_t: number | null;
  recorded_from: string | null;
  recorded_days?: number;
  saved_recorded?: number;
  /** Before readings began, from the install date, at today's rate. */
  saved_before?: number | null;
  saved_total?: number;
  per_year?: number | null;
  paid_pct?: number;
  paid_off?: boolean;
  payback_at?: number;
  payback_years?: number;
};
