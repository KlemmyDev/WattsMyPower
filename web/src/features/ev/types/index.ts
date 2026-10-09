/** How the dashboard charges an EV (app.features.tesla.control): off (shows it only), or from spare solar. */
export type EvMode = "off" | "solar";

export type EvControl = {
  mode: EvMode;
  /** The home battery fills at its full rate before the car gets spare solar. */
  battery_first: boolean;
  /** How far short (W) the car may run, from the grid or the home battery, before it's stopped. */
  grid_w: number;
};

/** What was last known of the car (through Tessie, or over Bluetooth). */
export type EvCarState = {
  as_of: number | null;
  asleep: boolean;
  /** Tesla's: Disconnected, NoPower, Starting, Charging, Stopped or Complete. */
  charging_state: string;
  plugged: boolean;
  charging: boolean;
  soc: number | null;
  limit: number | null;
  range_km: number | null;
  /** The current it's set to charge at. */
  amps: number | null;
  actual_amps: number | null;
  power_kw: number | null;
  energy_added: number | null;
  minutes_to_full: number | null;
  /** null: its location isn't known. */
  at_home: boolean | null;
  /** Over Bluetooth: whether it was heard (in range of the server, so at home). null through Tessie. */
  in_range: boolean | null;
};

export type EvStatus = "charging" | "waiting" | "stopped" | "complete" | "unplugged" | "away" | "hold" | "unknown";

export type EvVehicle = {
  vin: string;
  name: string | null;
  /** The dashboard car it's tied to (app.features.car). */
  car: number | null;
  control: EvControl;
  /** Where it counts as home, when set from the car's location; else the system's location. */
  home: [number, number] | null;
  /** Over Bluetooth: when it was paired (unix seconds). */
  paired_at: number | null;
  status: EvStatus;
  /** What it's doing, in a sentence. */
  doing: string;
  /** Why it's on hold (the household took over), until it's unplugged. */
  hold: string | null;
  /** Power there is for it now (W), averaged; null until known. */
  spare_w: number | null;
  /** How closely it's followed: charging; ready (could start soon: read each minute, and over Bluetooth kept
   * awake); or quiet (no chance of charging soon: left to sleep). */
  follow: "active" | "ready" | "quiet";
  /** When the forecast next expects enough spare solar for it (unix seconds); null when it doesn't (or not in solar
   * mode). */
  solar_from: number | null;
  /** While it's quiet: when it'll be made ready for that spare solar. */
  wake_at: number | null;
  /** Its lowest charging power (W). */
  min_w: number | null;
  min_amps: number | null;
  max_amps: number | null;
  phases: number | null;
  volts: number | null;
  /** The current spare solar alone would charge it at (0: not enough for its lowest current). */
  solar_amps: number | null;
  state: EvCarState | null;
};

/** How the cars are reached: Tessie's cloud, or this server's Bluetooth. The features are the same either way. */
export type TeslaProvider = "tessie" | "bluetooth";

/** A car being paired over Bluetooth: looking for it, waiting for the key card's tap, done, or failed (`error`). */
export type TeslaPairing = {
  vin: string;
  step: "looking" | "tap" | "done" | "failed";
  error: string | null;
  at: number;
};

export type TeslaStatus = {
  /** null until connected. */
  provider: TeslaProvider | null;
  connected: boolean;
  /** Tessie's access token, masked: "tess…cdef". */
  token: string | null;
  bluetooth: {
    /** This server's key, by a short fingerprint; null until a car's been paired. */
    key: string | null;
    pairing: TeslaPairing | null;
    /** Mock mode: the made-up car's VIN, to pair. */
    mock_vin: string | null;
  };
  error: string | null;
  read_at: number | null;
  home: [number, number];
  vehicles: EvVehicle[];
};

export type EvEvent = {
  ts: number;
  vin: string;
  text: string;
  kind: "solar" | "manual" | "mode" | "error" | null;
};

/** Each EV in brief, in the live status. */
export type EvBrief = Pick<EvVehicle, "vin" | "name" | "car" | "status" | "doing"> & {
  mode: EvMode;
  soc: number | null;
  limit: number | null;
  power_kw: number | null;
  amps: number | null;
};

export type EvCommand =
  { action: "start" | "stop" | "resume" } | { action: "amps"; amps: number } | { action: "limit"; percent: number };
