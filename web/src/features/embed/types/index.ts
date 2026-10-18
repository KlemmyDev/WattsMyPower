export type EmbedStatus = { enabled: boolean; token: string | null };

/** The live figures the shared page shows (W, the battery in %); null where the inverter hasn't said. */
export type EmbedPower = {
  solar_w: number | null;
  home_w: number | null;
  grid_w: number | null;
  battery_w: number | null;
  battery_pct: number | null;
  /** Unix seconds of the last reading. */
  updated: number | null;
};
