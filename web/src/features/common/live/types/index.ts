/** Live status from the inverter poller (GET /api/live, /api/stream). Times are unix seconds; power is W; energy is kWh. */
import type { Settings } from "~/features/common/settings/types";
import type { Tariff } from "~/features/common/tariffs/types";

export type Snapshot = {
  ts: number;
  pv_power: number | null;
  load_power: number | null;
  grid_power: number | null; // + importing, − exporting
  battery_power: number | null; // + discharging, − charging
  battery_soc: number | null; // %
  battery_soh?: number | null;
  battery_temp?: number | null;
  inverter_temp?: number | null;
  grid_freq?: number | null;
  daily_pv: number | null;
  daily_import: number | null;
  daily_export: number | null;
  daily_charge: number | null;
  daily_discharge: number | null;
  daily_direct?: number | null;
  total_pv?: number | null;
  total_import?: number | null;
  total_export?: number | null;
  total_charge?: number | null;
  total_discharge?: number | null;
  // Present when a second inverter is configured (see poller.merge_pv2).
  pv1_power?: number | null;
  pv2_power?: number | null;
  daily_pv2?: number | null;
  [field: string]: number | null | undefined;
};

export type SecondInverter = {
  host: string;
  behind_meter: boolean;
  brand?: string | null;
  model?: string | null;
  nominal_kw?: number | null;
  last_success: number | null;
  error: string | null;
};

export type SystemInfo = {
  brand: string | null;
  model: string | null;
  serial: string | null;
  nominal_kw: number | null;
  phases: string | null;
  pv_kw: number | null;
  battery_kwh: number | null;
  battery_reserve: number | null; // %
  battery_max_kw: number | null;
  forecast: boolean;
  tariff: Tariff;
  pv2: SecondInverter | null;
  tesla_connected?: boolean;
} & Settings;

export type LiveStatus = {
  snapshot: Snapshot | null;
  system: SystemInfo;
  model: string | null;
  mock: boolean;
  poll_interval: number;
  last_success: number | null;
  error: string | null;
};
