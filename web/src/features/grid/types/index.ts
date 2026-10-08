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

/** An outage on the electricity network, as the house sees it. Times are unix seconds (null when not given). */
export type Outage = {
  id: string;
  network: string;
  planned: boolean;
  status: string | null;
  reason: string | null;
  customers: number | null;
  start: number | null;
  end: number | null;
  /** The network's words when it gives no time back ("Under Investigation"). */
  end_text: string | null;
  streets: string[];
  suburbs: string[];
  lat: number;
  lon: number;
  distance_km: number;
  direction: string;
  /** It reaches the house: it lists the house's street, or its area covers the house. */
  affects: "street" | "area" | null;
};

/** The network's outages around the house (Energex, Ergon Energy). */
export type OutagesView = {
  network: { id: string; name: string; site: string } | null;
  network_auto: boolean;
  /** The house is somewhere a network is supported (Queensland, for now), or one was chosen. */
  supported: boolean;
  radius_km: number;
  street: string | null;
  suburb: string | null;
  /** Outages now (and planned work under way) that reach the house or are within the radius, ours first. */
  now: Outage[];
  /** Planned work to come at the house's street, or within the radius in the next two weeks, soonest first. */
  planned: Outage[];
  summary: { outages: number; customers: number; nearest_km: number | null };
  fetched_at: number | null;
  error: string | null;
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
  outages: OutagesView | null;
  fetched_at: number | null;
  error: string | null;
  limits: { voltage_low: number; voltage_high: number; freq_low: number; freq_high: number; spike: number };
};
