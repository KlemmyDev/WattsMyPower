/** Car charges planned ahead (GET /api/car, POST /api/car/estimate and /api/car/charges). */

/** The car's details, from Settings: battery size (kWh), charging efficiency (%), and its usual amps, phases and volts. */
export type CarDetails = {
  car_battery_kwh: number;
  car_efficiency: number;
  car_amps: number;
  car_phases: number;
  car_voltage: number;
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

export type CarView = { car: CarDetails; charges: PlannedCharge[] };

/** A charge as the form gives it: a level to stop at (soc_to) or a time to run (hours). */
export type ChargeRequest = {
  start: number;
  amps: number;
  phases: number;
  soc_now: number | null;
  soc_to: number | null;
  hours: number | null;
  battery_helps: boolean;
};
