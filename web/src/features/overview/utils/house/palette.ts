/*
 * The house's colours and materials (Settings → Your house → Look): what its walls are made of and their colour, and
 * the roof's colour. Each house style has its own, and either can be swapped for one of these. Colours are given once,
 * for the face that looks at the street; the faces turned away are worked out from it, so every choice is lit alike.
 */

export type Material = "render" | "brick" | "boards" | "battens";

export type WallFinish =
  | "render_white"
  | "render_sand"
  | "render_charcoal"
  | "brick_red"
  | "brick_blonde"
  | "brick_brown"
  | "boards_white"
  | "boards_sage"
  | "boards_blue"
  | "cladding_charcoal";

export type RoofColour =
  "monument" | "woodland" | "basalt" | "shale" | "surfmist" | "galvanised" | "terracotta" | "manor_red" | "night_sky";

/** A wall finish as the drawing uses it: the face towards the street, the side, the plinth along the ground, and the
 * lines its material draws over it (mortar, board edges, battens). */
export type Finish = {
  name: string;
  material: Material;
  face: string;
  side: string;
  plinth: string;
  line: string;
};

export type Roof = {
  name: string;
  /** The slope towards the street, the one beside it (facing right), the back slope, and the ridge and hip caps. */
  face: string;
  side: string;
  back: string;
  cap: string;
  /** Seams, ribs or rows of tiles: dark on a pale roof, pale on a dark one. */
  line: string;
};

/** A hex colour lightened (k > 0, towards white) or darkened (k < 0, towards black) by k (0..1). */
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k)),
  );
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** How light a colour looks, 0 (black) to 1 (white). */
export function lightness(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

const finish = (name: string, material: Material, face: string, side?: string): Finish => {
  const pale = lightness(face) > 0.6;
  return {
    name,
    material,
    face,
    side: side ?? shade(face, pale ? -0.1 : -0.16),
    plinth: shade(face, pale ? -0.13 : -0.22),
    line:
      material === "brick"
        ? "rgba(255,244,230,0.16)"
        : material === "battens"
          ? shade(face, 0.1)
          : pale
            ? "rgba(0,0,0,0.065)"
            : "rgba(0,0,0,0.16)",
  };
};

export const FINISHES: Record<WallFinish, Finish> = {
  render_white: finish("White render", "render", "#f6f2eb", "#ddd6ca"),
  render_sand: finish("Sandstone render", "render", "#e9dcc4", "#d3c3a6"),
  render_charcoal: finish("Charcoal render", "render", "#4f5359", "#41454a"),
  brick_red: finish("Red brick", "brick", "#b5553f", "#9a4533"),
  brick_blonde: finish("Blonde brick", "brick", "#d9be93", "#c2a679"),
  brick_brown: finish("Brown brick", "brick", "#8a5a44", "#734a37"),
  boards_white: finish("White weatherboard", "boards", "#f3eee2", "#e2dacb"),
  boards_sage: finish("Sage weatherboard", "boards", "#b9c4ad", "#a3af97"),
  boards_blue: finish("Blue-grey weatherboard", "boards", "#a9b8c4", "#94a3b0"),
  cladding_charcoal: finish("Charcoal cladding", "battens", "#3a3d42", "#2f3236"),
};

const roof = (name: string, face: string): Roof => {
  const pale = lightness(face) > 0.55;
  const n = parseInt(face.slice(1), 16);
  const warm = ((n >> 16) & 255) - (n & 255) > 50; // terracotta and reds: their joints show darker, not paler
  return {
    name,
    face,
    side: shade(face, pale ? -0.13 : -0.2),
    back: shade(face, pale ? -0.22 : -0.32),
    cap: pale ? shade(face, 0.45) : shade(face, warm ? 0.3 : 0.24),
    line: pale ? "rgba(0,0,0,0.09)" : warm ? "rgba(70,18,0,0.2)" : "rgba(255,255,255,0.08)",
  };
};

/** Roof colours, named as the colours roofing comes in. */
export const ROOFS: Record<RoofColour, Roof> = {
  monument: roof("Monument", "#4a5059"),
  woodland: roof("Woodland Grey", "#5d6259"),
  basalt: roof("Basalt", "#6e7176"),
  shale: roof("Shale Grey", "#b7bab6"),
  surfmist: roof("Surfmist", "#e5e3da"),
  galvanised: roof("Galvanised", "#c6cdd3"),
  terracotta: roof("Terracotta", "#c8643f"),
  manor_red: roof("Manor Red", "#7c3326"),
  night_sky: roof("Night Sky", "#2a2c30"),
};

export const WALL_FINISHES = Object.keys(FINISHES) as WallFinish[];
export const ROOF_COLOURS = Object.keys(ROOFS) as RoofColour[];
