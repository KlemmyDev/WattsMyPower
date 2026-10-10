import type { CarBody, CarColour, NamedPaint, CarView } from "~/features/car/types";

export const phaseWord = (n: number) => (n === 3 ? "three-phase" : n === 1 ? "single phase" : `${n}-phase`);

/** A car's name: what it's called, or its model, or just "Your car". */
export const carName = (v: CarView | undefined) => v?.name || v?.model?.model || "Your car";

/** Each paint's name, and its colour in the drawing. */
export const PAINT: Record<NamedPaint, { label: string; hex: string }> = {
  white: { label: "White", hex: "#f3f3f0" },
  black: { label: "Black", hex: "#202226" },
  grey: { label: "Grey", hex: "#5f646b" },
  silver: { label: "Silver", hex: "#b8bcc2" },
  blue: { label: "Blue", hex: "#2a4f8f" },
  red: { label: "Red", hex: "#a5161f" },
  green: { label: "Green", hex: "#3f5c4a" },
  sand: { label: "Sand", hex: "#cbbd9f" },
};
export const PAINTS = Object.keys(PAINT) as NamedPaint[];

/** A paint's name and colour: a named one's, or "Custom" and the colour itself. */
export const paintOf = (c: CarColour): { label: string; hex: string } =>
  c.startsWith("#") ? { label: "Custom", hex: c } : (PAINT[c as NamedPaint] ?? PAINT.white);

/** What each shape is called. */
export const BODY: Record<CarBody, string> = {
  model3: "Tesla Model 3",
  modelY: "Tesla Model Y",
  modelS: "Tesla Model S",
  modelX: "Tesla Model X",
  cybertruck: "Tesla Cybertruck",
  atto3: "BYD Atto 3",
  dolphin: "BYD Dolphin",
  seal: "BYD Seal",
  sealion7: "BYD Sealion 7",
  ioniq5: "Hyundai Ioniq 5",
  sedan: "Sedan",
  suv: "SUV",
  hatch: "Hatchback",
};
export const BODIES = Object.keys(BODY) as CarBody[];
