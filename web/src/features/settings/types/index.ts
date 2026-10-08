/** Plan search and import (GET /api/plans/search, /api/plans/tariff) and place search (GET /api/geocode). */
import type { Tariff } from "~/features/common/tariffs/types";

export type PlanSummary = {
  id: string;
  name: string;
  type: string; // MARKET | STANDING | REGULATED
  pricing: string; // tou | flat | other
  controlled_load: boolean;
  demand: boolean;
  rates: { name: string; price: number }[];
  supply: number | null;
  feed_in: number | null;
  updated: string;
};

export type PlanSearch = {
  brand: string;
  postcode: string;
  plans: PlanSummary[];
  truncated: boolean;
  limit: number;
};

export type PlanTariff = {
  tariff: Tariff;
  notes: string[];
  plan: { name: string; brand: string; id: string; type: string; updated: string };
};

export type Place = {
  label: string;
  detail: string;
  name: string;
  latitude: number;
  longitude: number;
  /** The street's name and the suburb, for matching the network's outages. */
  road?: string | null;
  suburb?: string | null;
};
