/** Settings editable from the dashboard (GET/PUT /api/settings). */
export type Settings = {
  latitude: number;
  longitude: number;
  /** The billing period: every 1, 2 or 3 months from this day of the month (1-28), in step with a month (1-12) a bill starts in. */
  bill_months: number;
  bill_day: number;
  bill_anchor: number;
  location_name: string | null;
  /**
   * What the inverter can't report (Settings → System): the array size in kW, the battery's capacity in kWh
   * (0 = what the inverter reports), the reserve (%) used when the inverter doesn't report one, and its maximum rate in kW.
   */
  pv_kw: number;
  battery_kwh_override: number;
  battery_reserve_fallback: number;
  battery_max_kw: number;
};

export type SystemSettingKey = "pv_kw" | "battery_kwh_override" | "battery_reserve_fallback" | "battery_max_kw";

export const SYSTEM_SETTINGS: SystemSettingKey[] = [
  "pv_kw",
  "battery_kwh_override",
  "battery_reserve_fallback",
  "battery_max_kw",
];
