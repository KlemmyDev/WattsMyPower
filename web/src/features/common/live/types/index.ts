/** Live status from the inverter poller (GET /api/live, /api/stream). Times are unix seconds; power is W; energy is kWh. */
import type { Settings } from "~/features/common/settings/types";
import type { Tariff } from "~/features/common/tariffs/types";
import type { EvBrief } from "~/features/ev/types";

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
  grid_voltage?: number | null; // V, the AC side's (the grid's while it's connected)
  running_state?: number | null; // the inverter's raw running state (0x1000: off-grid)
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
  /** What the inverter itself reports (battery_kwh and battery_reserve fall back to Settings). */
  inverter_battery_kwh: number | null;
  inverter_reserve: number | null; // %
  forecast: boolean;
  tariff: Tariff;
  pv2: SecondInverter | null;
  ev_connected?: boolean;
  /** Whether a main inverter is connected: false once the collector says there's none, null until it's been asked. */
  inverter_connected?: boolean | null;
} & Settings;

/** What the battery is set to do (app.features.battery): who has it, and the control in effect from the dashboard or
 * what another controller is doing. Missing when the inverter's battery can't be controlled from here. */
export type BatteryMode = {
  /** normal: self-consumption; dashboard: a control here; isolarcloud: a command from its app (VPP mode); external: an
   * energy manager; elsewhere: forced mode set outside the dashboard; unknown: a mode not known; null: not read yet. */
  owner: "normal" | "dashboard" | "isolarcloud" | "external" | "elsewhere" | "unknown" | null;
  /** Why the controls are off for this inverter's model (they haven't been tried on it); null when they can be used. */
  untried?: string | null;
  min_soc: number | null;
  max_soc?: number | null;
  kind?: "standby" | "floor" | "charge";
  until?: number | null;
  floor?: number | null;
  target?: number | null;
  power_w?: number | null;
  /** Set once a control is done but not yet put back (a floor waits for iSolarCloud's command to end). */
  ending?: string | null;
  /** What another controller has the battery doing. */
  command?: "charge" | "discharge" | "stop" | null;
};

export type LiveStatus = {
  snapshot: Snapshot | null;
  system: SystemInfo;
  model: string | null;
  mock: boolean;
  poll_interval: number;
  last_success: number | null;
  /** When the inverters are next read (unix seconds): a poll interval on, or the backoff after a failed poll. In the past while a poll is under way; null with no inverter connected. */
  next_poll?: number | null;
  error: string | null;
  /** While the inverter's dongle keeps serving the same registers: when the reading it repeats was taken. The repeats aren't recorded, so `snapshot` stays at that reading. */
  frozen_since?: number | null;
  battery_mode?: BatteryMode | null;
  /** Which version this is: the date it was released ("2026.10.8"), and how far along it is (e.g. "alpha"; null
   * once it's stable, as now). */
  app?: { version: string; release: string | null; commit: string | null };
  /** The site's time zone, e.g. "Australia/Brisbane": the server's, which its days are kept in. Days, hours and clock
   * times are drawn in it, whatever zone the browser is in. Null if the server can't name it. */
  time_zone?: string | null;
  /** Each EV in brief (app.features.tesla); null when none is connected. */
  ev?: EvBrief[] | null;
};
