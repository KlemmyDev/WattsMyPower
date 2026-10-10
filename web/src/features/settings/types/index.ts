/** Place search (GET /api/geocode). */

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
