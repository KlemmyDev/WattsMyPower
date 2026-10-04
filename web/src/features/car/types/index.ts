/** The car (GET /api/car, /api/car/models; POST /api/car/estimate, /charges, /level and /suggest). */

/**
 * The car's details, from Settings: battery size (kWh), charging efficiency (%), the charger's current at most and
 * the car's at least (A), phases and volts; what it uses on the road (Wh/km); the level it's charged to (%); when
 * it's usually needed (minutes after midnight); and whether the home battery may help charge it (1).
 */
export type CarDetails = {
  car_battery_kwh: number;
  car_efficiency: number;
  car_amps: number;
  car_min_amps: number;
  car_phases: number;
  car_voltage: number;
  car_wh_per_km: number;
  car_target_soc: number;
  car_ready_by: number;
  car_battery_helps: number;
};

/** A car to choose from when connecting one, with its usual details. */
export type CarModel = {
  id: string;
  make: string;
  model: string;
  battery_kwh: number;
  wh_per_km: number;
  ac_kw: number;
  phases: number;
  max_amps: number;
  min_amps: number;
  /** A lithium iron phosphate battery: its maker says to charge it to 100% regularly. */
  lfp: boolean;
  target_soc: number;
};

/** The car's level now: as last given, plus what planned charges have put in since. */
export type CarLevel = {
  soc: number;
  given: number;
  given_at: number;
  /** Planned charges since it was given have added to it. */
  charged: boolean;
  /** Range left at what it uses on the road. */
  km: number;
};

/** What a charge comes to: its power from the wall, how long it runs, the energy, and the car's charge at each end. */
export type ChargeEstimate = {
  start: number;
  end: number;
  power_kw: number;
  hours: number;
  wall_kwh: number;
  car_kwh: number;
  soc_from: number | null;
  soc_to: number | null;
  amps: number;
  phases: number;
};

export type PlannedCharge = Omit<ChargeEstimate, "hours" | "car_kwh"> & { id: number; battery_helps: boolean };

export type CarView = {
  connected: boolean;
  name: string | null;
  model: CarModel | null;
  car: CarDetails;
  level: CarLevel | null;
  charges: PlannedCharge[];
};

/** A charge as the form gives it: a level to stop at (soc_to) or a time to run (hours). */
export type ChargeRequest = {
  start: number;
  amps: number;
  phases: number;
  soc_now: number | null;
  soc_to: number | null;
  hours: number | null;
  battery_helps: boolean;
  /** soc_now is the car's level now, to remember (the default); false when it's where an earlier charge leaves it. */
  level_now?: boolean;
};

/** What to suggest a charge for: missing values are the car's last level, its usual limit and its usual time. */
export type SuggestRequest = { soc_now?: number; soc_to?: number; ready_by?: number };

/** A suggested charge: one start and one current, to set in the car's app. Cost is what it adds to the bill ($). */
export type SuggestedCharge = {
  /** best: the cheapest; solar: the most solar; now: starting now at full speed. */
  kind: "best" | "solar" | "now";
  start: number;
  end: number;
  amps: number;
  phases: number;
  power_kw: number;
  wall_kwh: number;
  car_kwh: number;
  soc_from: number;
  soc_to: number;
  km: number;
  cost: number;
  solar_kwh: number;
  solar_share: number;
};

export type Suggestions = {
  soc_now: number;
  soc_to: number;
  ready_by: number;
  /** The car's level by then from charges already planned, when they add to it. */
  planned_soc: number | null;
  /** Charges already planned get it there: nothing to suggest. */
  covered: boolean;
  wall_kwh: number;
  car_kwh: number;
  km: number;
  /** Solar forecast to go to the grid before it's needed. */
  spare_kwh: number | null;
  /** It can get there in time; if not, the one option is full speed from now, and how far it gets. */
  reachable: boolean;
  options: SuggestedCharge[];
  /** For a car charged on three phases: the best on one, when it costs noticeably less. */
  single_phase: Omit<SuggestedCharge, "kind"> | null;
};
