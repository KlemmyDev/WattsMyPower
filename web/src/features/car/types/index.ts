/** The cars (GET /api/cars, /api/cars/models; POST /api/cars; PUT and DELETE /api/cars/{id}). */

/**
 * The car's details, from Settings: battery size (kWh), the charger's current at most and the car's at least (A),
 * phases and volts; and what it uses on the road (Wh/km).
 */
export type CarDetails = {
  car_battery_kwh: number;
  car_amps: number;
  car_min_amps: number;
  car_phases: number;
  car_voltage: number;
  car_wh_per_km: number;
  /** How the Overview draws it: its paint, its shape, and whether it parks in the garage or outside. */
  car_colour: CarColour;
  car_body: CarBody;
  car_park: "garage" | "outside";
};

/** A paint: one of the named ones, or a colour of its own (#rrggbb). */
export type CarColour = NamedPaint | `#${string}`;
export type NamedPaint = "white" | "black" | "grey" | "silver" | "blue" | "red" | "green" | "sand";

/** The shapes the Overview draws a car as: some popular models of their own, and three for every other. */
export type CarBody =
  "model3" | "modelY" | "atto3" | "dolphin" | "seal" | "sealion7" | "ioniq5" | "sedan" | "suv" | "hatch";

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
  body: CarBody;
};

/** The car's level as last read from the car. */
export type CarLevel = {
  soc: number;
  given: number;
  given_at: number;
  /** Range left at what it uses on the road. */
  km: number;
};

/** A connected car: its name, the model it was chosen from, its details, and its level. */
export type CarView = {
  id: number;
  name: string | null;
  model: CarModel | null;
  car: CarDetails;
  level: CarLevel | null;
};

/** A car's changes (PUT /api/cars/{id}): its name, model and any of its details. */
export type CarChanges = Partial<CarDetails> & { name?: string | null; model?: string | null };
