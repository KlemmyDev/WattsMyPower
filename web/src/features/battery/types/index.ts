/** What the battery controls work with (app/features/battery on the server). */

export type ControlKind = "standby" | "floor" | "charge";

/** Who has the battery: self-consumption, a control here, iSolarCloud (its app's remote commands), an external
 * energy manager, forced mode set elsewhere, or a mode the dashboard doesn't know. */
export type BatteryOwner = "normal" | "dashboard" | "isolarcloud" | "external" | "elsewhere" | "unknown";

/** The battery's settings as the inverter reports them. */
export type BatterySettings = {
  mode: "self" | "forced" | "external" | "vpp" | "other" | null;
  mode_code: number | null;
  command: "charge" | "discharge" | "stop" | null;
  power_w: number | null;
  max_soc: number | null;
  min_soc: number | null;
  max_charge_w: number | null;
};

/** The control in effect. `ending` is set once it's done but not yet put back (a floor waits for iSolarCloud). */
export type BatteryControl = {
  kind: ControlKind;
  started_at: number;
  until: number | null;
  usual_floor: number | null;
  floor?: number;
  power_w?: number;
  target?: number;
  written_at: number;
  confirmed: boolean;
  ending?: string | null;
};

/** What a control will do (app/features/battery/plan.py): the battery's level as it runs ([unix seconds, %]), when it
 * ends (null: until stopped, worked out to `to`), and the grid energy and cost; with the same stretch as normal. */
export type BatteryPlan = {
  kind: ControlKind;
  floor: number | null;
  target: number | null;
  from: number;
  to: number;
  ends_at: number | null;
  points: [number, number][];
  soc_end: number;
  grid_kwh: number;
  cost: number;
  normal_grid_kwh: number;
  normal_cost: number;
  /** A charge: the energy for the battery that solar didn't cover, what it costs, and whether it reaches its level. */
  charge_grid_kwh?: number;
  charge_cost?: number;
  reaches?: boolean;
};

/** A control as it ran (or is running: `ended_at` null), for the chart. */
export type ControlRecord = {
  kind: ControlKind;
  started_at: number;
  ended_at: number | null;
  until: number | null;
  floor: number | null;
  target: number | null;
  power_w: number | null;
  ended_by: string | null;
};

export type BatteryEvent = { ts: number; text: string; kind: ControlKind | null; until: number | null };

export type BatteryView =
  | {
      supported: true;
      settings: BatterySettings | null;
      read_at: number | null;
      error: string | null;
      owner: BatteryOwner | null;
      blocked: string | null;
      control: BatteryControl | null;
      limits: { floor: [number, number]; charge_w: [number, number]; max_hours: number };
      log: BatteryEvent[];
      /** What the control in effect will do from now on. */
      plan: BatteryPlan | null;
    }
  | { supported: false; reason: string; log: BatteryEvent[] };

export type ControlRequest = {
  kind: ControlKind;
  until: number | null;
  floor?: number;
  power_w?: number;
  target?: number;
};
