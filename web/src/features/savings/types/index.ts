/** The Savings page: bill and payback (GET /api/savings) and plan comparison (GET /api/plans/compare). */
import type { Tariff } from "~/features/common/tariffs/types";

export type BillFigures = {
  import_kwh: number;
  import_cost: number;
  export_kwh: number;
  feed_in_credit: number;
  supply: number;
  net_cost: number;
  saved: number;
  without_solar: number;
};

export type Savings = {
  generated_at: number;
  bill: {
    start: number;
    end: number;
    day: number;
    days: number;
    so_far: BillFigures & { days: number };
    estimate: BillFigures | null;
    basis_days: number;
  };
  payback: {
    system_cost: number | null;
    saved_lifetime: number | null;
    rate: number | null;
    per_month: number | null;
    basis_days: number;
  };
  profile_days: number;
  min_profile_days: number;
};

export type YearlyCost = { total: number; [part: string]: number };

export type PlanComparison = {
  profile_days: number;
  min_days: number;
  current: { tariff: Tariff; cost: YearlyCost };
  plans: { id: string; name: string; type: string; tariff: Tariff; notes: string[]; cost: YearlyCost }[];
  skipped: number;
  checked: number;
  excluded: number;
  brand: string;
  postcode: string;
};
