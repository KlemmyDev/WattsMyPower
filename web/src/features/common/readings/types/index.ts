/** Recorded readings: time series (GET /api/history) and per-day costs (GET /api/costs). */
import type { Tariff } from "~/features/common/tariffs/types";

export type HistorySeries = { t: number[] } & Record<string, (number | null)[]>;

export type HistoryResponse = { bucket: number; source: string; series: HistorySeries };

export type CostBand = {
  name: string;
  rate: number;
  import_kwh: number;
  home_kwh: number;
  self_kwh: number;
  cost: number;
  saved: number;
  /** On Amber: what this band's home use would have cost from the grid, at the prices of the time. */
  home_cost?: number;
};

export type CostDay = {
  date: string;
  import_kwh: number;
  export_kwh: number;
  home_kwh: number;
  import_cost: number;
  supply: number;
  feed_in_credit: number;
  grid_cost: number;
  net_cost: number;
  saved: number;
  bands: CostBand[];
  /** On Amber: the average feed-in price earned (negative when exporting cost money). */
  feed_in_rate?: number | null;
  /** On Amber: kWh costed at the fallback rates because Amber had no price for their time. */
  unpriced_kwh?: number;
};

export type CostsResponse = { type: Tariff["type"]; days: CostDay[] };
