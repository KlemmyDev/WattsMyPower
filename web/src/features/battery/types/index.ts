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
    }
  | { supported: false; reason: string; log: BatteryEvent[] };

export type ControlRequest = {
  kind: ControlKind;
  until: number | null;
  floor?: number;
  power_w?: number;
  target?: number;
};
