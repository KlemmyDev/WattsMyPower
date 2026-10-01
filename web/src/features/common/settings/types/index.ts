/** Settings editable from the dashboard (GET/PUT /api/settings). */
export type Settings = {
  latitude: number;
  longitude: number;
  system_cost: number;
  location_name: string | null;
};
