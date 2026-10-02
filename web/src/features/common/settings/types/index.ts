/** Settings editable from the dashboard (GET/PUT /api/settings). */
export type Settings = {
  latitude: number;
  longitude: number;
  /** The billing period: every 1, 2 or 3 months from this day of the month (1-28), in step with a month (1-12) a bill starts in. */
  bill_months: number;
  bill_day: number;
  bill_anchor: number;
  location_name: string | null;
};
