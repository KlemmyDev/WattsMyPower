/** The grid (GET /api/grid): the region's wholesale market from AEMO, its notices, storms coming, and the outlook. */

export type NemRegion = "QLD1" | "NSW1" | "VIC1" | "SA1" | "TAS1";

/** The region's market now. Prices are $/MWh (a tenth of a cent per kWh), demand MW. */
export type Market = {
  at: number;
  price: number | null;
  demand: number | null;
  status: string | null;
  capped: boolean;
  suspended: boolean;
};

/** A wholesale price: five-minute actuals, then pre-dispatch half hours ahead (`forecast`). `at` is its end. */
export type WholesalePrice = { at: number; price: number | null; forecast: boolean };

export type NoticeKind =
  "lor1" | "lor2" | "lor3" | "load_shedding" | "system_event" | "suspension" | "price_cap" | "msl1" | "msl2" | "msl3";

/** An AEMO market notice about the region. `active` until it's cancelled or twelve hours old. */
export type MarketNotice = {
  id: number;
  at: number;
  kind: NoticeKind;
  level: "info" | "warning" | "critical";
  cancels: boolean;
  active: boolean;
  title: string;
  body: string;
  regions: NemRegion[];
};

export type OutlookLevel = "normal" | "watch" | "warning" | "outage";

export type OutlookReason = {
  kind: string;
  level: OutlookLevel;
  title: string;
  detail: string;
  at?: number;
  /** It's one the blackout risk alert tells of. */
  alert?: boolean;
};

export type GridView = {
  /** AEMO is followed: the house is in the NEM, and it hasn't been turned off. */
  enabled: boolean;
  region: NemRegion | null;
  region_name: string | null;
  /** The region was worked out from the location rather than chosen. */
  region_auto: boolean;
  market: Market | null;
  prices: WholesalePrice[];
  notices: MarketNotice[];
  /** Hours with thunderstorms forecast in the next day (`ts` is the hour's end). */
  storms: { ts: number; code: number; precip_prob: number | null }[];
  outlook: { level: OutlookLevel; reasons: OutlookReason[] };
  fetched_at: number | null;
  error: string | null;
  limits: { voltage_low: number; voltage_high: number; freq_low: number; freq_high: number; spike: number };
};
