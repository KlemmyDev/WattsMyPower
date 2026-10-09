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
  /** When it was last read (heard, over Bluetooth); its charge reading's own time is state.as_of. */
  seen_at: number | null;
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
  kind: "solar" | "manual" | "mode" | "error" | "trip" | "charge" | "wake" | null;
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

/** One group of a car's details: what was read and when, or why the car won't give it to the dashboard's key. */
export type DetailGroup<T> =
  { as_of: number | null; data: T; refused?: undefined } | { as_of: number | null; refused: string; data?: undefined };

export type ChargeSchedule = {
  name: string | null;
  days: string[];
  /** Minutes after midnight; null: it doesn't start (or end) at a set time. */
  start: number | null;
  end: number | null;
  one_time: boolean;
  enabled: boolean;
};

export type PreconditionSchedule = {
  name: string | null;
  days: string[];
  time: number | null;
  one_time: boolean;
  enabled: boolean;
};

export type SoftwareUpdate = {
  status: "available" | "downloading" | "waiting_for_wifi" | "scheduled" | "installing" | string;
  version: string | null;
  download_pct: number | null;
  install_pct: number | null;
  scheduled_at: number | null;
  minutes: number | null;
};

/** A car's details beyond its charge (app.features.tesla.details), group by group. */
export type EvDetailGroups = {
  status: DetailGroup<{ locked: boolean | null; open: string[]; user_present: boolean | null; gear: string | null }>;
  charging: DetailGroup<{
    pilot_amps: number | null;
    cable: string | null;
    latch: string | null;
    minutes_to_limit: number | null;
    usable_soc: number | null;
    energy_added: number | null;
    battery_heater: boolean | null;
    low_power_mode: boolean | null;
  }>;
  schedule: DetailGroup<{
    mode: "off" | "start_at" | "depart_by" | string;
    start_minutes: number | null;
    departure_minutes: number | null;
    preconditioning: boolean | null;
    /** null: not read (only the charge reading's scheduled charging is known). */
    charge_schedules: ChargeSchedule[] | null;
    precondition_schedules: PreconditionSchedule[] | null;
  }>;
  climate: DetailGroup<{
    inside_c: number | null;
    outside_c: number | null;
    climate_on: boolean | null;
    preconditioning: boolean | null;
    keeper: "On" | "Dog" | "Camp" | null;
    cabin_overheat: "on" | "fan_only" | "off" | null;
    battery_heater: boolean | null;
    defrost: boolean | null;
  }>;
  security: DetailGroup<{
    sentry: string | null;
    sentry_available: boolean | null;
    valet: boolean | null;
    windows_open: string[];
  }>;
  tyres: DetailGroup<{
    fl: number | null;
    fr: number | null;
    rl: number | null;
    rr: number | null;
    warnings: string[];
  }>;
  driving: DetailGroup<{
    odometer_km: number | null;
    gear: string | null;
    speed_kmh: number | null;
    power_kw: number | null;
  }>;
  software: DetailGroup<{ version: string | null; update: SoftwareUpdate | null }>;
  media: DetailGroup<{
    playing: boolean;
    title: string | null;
    artist: string | null;
    source: string | null;
    volume: number | null;
  }>;
};

export type EvDetails = {
  vin: string;
  provider: TeslaProvider | null;
  seen_at: number | null;
  asleep: boolean | null;
  in_range: boolean | null;
  /** The car's asleep: refreshing its details now would wake it (the page asks first). */
  refresh_wakes: boolean;
  /** Over Bluetooth: seconds between reads of its details while it's awake. */
  every: number | null;
  groups: Partial<EvDetailGroups>;
  /** What's using power while it's parked (plugged in, from the house). */
  parked_draw: string[];
  /** Why the car may start charging by itself (a schedule set in it); null when nothing will. */
  overrides_solar: string | null;
};

/** One session of a car's in and out: time away, or a charge at home. */
export type EvSession = {
  id: number;
  kind: "away" | "charge";
  start: number;
  /** null: still under way. */
  end: number | null;
  soc_start: number | null;
  soc_end: number | null;
  soc_change: number | null;
  km: number | null;
  /** Away: what it used (kWh, from its battery size); negative when it came back fuller. */
  used_kwh?: number | null;
  kwh_per_100km?: number | null;
  /** A charge: from the house, and of it from the grid. */
  kwh?: number;
  grid_kwh?: number;
  solar_share?: number | null;
};

export type EvHistory = {
  vin: string;
  days: number;
  battery_kwh: number | null;
  sessions: EvSession[];
  totals: {
    charged_kwh: number;
    grid_kwh: number;
    solar_share: number | null;
    charges: number;
    trips: number;
    km: number | null;
    kwh_per_100km: number | null;
  };
  home: { soc: number | null; soc_at: number | null; gone_since: number | null };
};

/** A car's level through a stretch of time, with when it was away and when it charged at home. */
export type EvLevels = {
  vin: string;
  start: number;
  end: number;
  /** As recorded: each change of a percent, and every 15 minutes it's read; with the readings either side. */
  points: { t: number; soc: number }[];
  away: { start: number; end: number }[];
  charging: { start: number; end: number }[];
  /** Each time the dashboard woke the car, and why. */
  wakes: { t: number; reason: "first" | "ready" | "refresh" | "command" | "solar" | string }[];
  limit: number | null;
};
