/** Per-day energy totals (GET /api/daily), in kWh. */
export type DailyRow = {
  date: string; // YYYY-MM-DD
  daily_pv: number | null;
  daily_import: number | null;
  daily_export: number | null;
  daily_charge: number | null;
  daily_discharge: number | null;
  daily_direct: number | null;
  daily_pv2: number | null;
};
