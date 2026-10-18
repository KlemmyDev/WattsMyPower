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

/** How the shared page looks: tiles in a row, one compact strip, a circuit joined by lines, or a column of rows. */
export const VARIANTS = ["tiles", "compact", "circuit", "stack"] as const;
export type EmbedVariant = (typeof VARIANTS)[number];
export type EmbedTheme = "auto" | "light" | "dark";

/** A good frame height for each look, in pixels. */
export const VARIANT_HEIGHT: Record<EmbedVariant, number> = { tiles: 190, compact: 64, circuit: 140, stack: 220 };
