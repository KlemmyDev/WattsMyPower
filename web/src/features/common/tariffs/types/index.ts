/** Electricity tariff (GET/PUT /api/tariff). Rates are AUD per kWh; the supply charge is AUD per day. */
export type TimeWindow = { days: "all" | "weekdays" | "weekends"; start: string; end: string };

export type TariffBand = {
  name: string;
  rate: number | "";
  windows: TimeWindow[];
  /** Applies at all times not covered by another band's windows. */
  other?: boolean;
};

export type TariffSource = {
  brand: string;
  brand_id: string;
  plan_name: string;
  plan_id: string;
  updated?: string;
};

export type Tariff = {
  type: "flat" | "tou";
  flat_rate: number | "";
  feed_in_rate: number | "";
  supply_charge: number | "";
  bands: TariffBand[];
  source?: TariffSource | null;
};
