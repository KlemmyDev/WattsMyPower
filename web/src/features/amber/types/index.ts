/** Amber Electric (GET/PUT/DELETE /api/amber, PUT /api/amber/site, GET /api/amber/prices). */

export type AmberSite = {
  id: string;
  nmi: string;
  network: string;
  status: "pending" | "active" | "closed" | string;
  /** Minutes per price: 5 for sites billed on 5-minute prices, else 30. */
  interval_length: 5 | 30 | null;
  active_from: string | null;
  channels: string[];
};

export type AmberStatus = {
  connected: boolean;
  /** The API key, masked ("psk_…9f2c"). The full key never leaves the server. */
  key: string | null;
  sites: AmberSite[];
  site_id: string | null;
  interval_length: 5 | 30 | null;
  /** Start of the oldest final price stored (unix seconds). */
  prices_from: number | null;
  /** End of the furthest price stored, forecasts included. */
  prices_until: number | null;
  backfilling: boolean;
  last_sync: number | null;
  error: string | null;
};

/** One priced interval. `rate` is $/kWh incl. GST; on feed-in it's what a kWh exported earns (negative: it costs). */
export type PriceInterval = { start: number; end: number; rate: number; actual: boolean };

export type AmberPrices = {
  interval_length: 5 | 30 | null;
  general: PriceInterval[];
  feed_in: PriceInterval[];
  now: { general: number | null; feed_in: number | null };
};
