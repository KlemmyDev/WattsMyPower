import type { CarBody } from "~/features/car/types";

/*
 * How the Overview's house draws each connected EV: the shape it's drawn as (app's car shapes, in
 * features/overview/utils/house/cars.ts), and its paint when nothing says what colour it is. Looked up by make, then
 * model, as the EV integration names them ("Tesla", "Model Y"); a make or model not listed is drawn as its make's
 * usual shape, else an SUV. Another make's integration adds its models here (and any shapes of its own to cars.ts).
 */

/** How a model is drawn: its shape, and its paint (#rrggbb) when neither the car nor its details say. */
export type CarLook = { body: CarBody; paint?: string };

type MakeLooks = {
  /** Each model by its name in lower case, letters and digits only ("modely"). The longest that starts the
   * model's name is the one used, so "Model Y Performance" is a Model Y; list a longer name to tell one apart
   * ("sealu", a Seal U, isn't a Seal). */
  models: Record<string, CarLook>;
  /** Any other model of the make. */
  other: CarLook;
};

export const LOOKS: Record<string, MakeLooks> = {
  tesla: {
    models: {
      model3: { body: "model3" },
      modely: { body: "modelY" },
      models: { body: "modelS" },
      modelx: { body: "modelX" },
      cybertruck: { body: "cybertruck", paint: "#a9adb1" }, // bare stainless steel
    },
    other: { body: "modelY" },
  },
  byd: {
    models: {
      atto3: { body: "atto3" },
      dolphin: { body: "dolphin" },
      seal: { body: "seal" },
      sealu: { body: "suv" },
      sealion: { body: "suv" },
      sealion7: { body: "sealion7" },
    },
    other: { body: "suv" },
  },
  hyundai: {
    models: {
      ioniq5: { body: "ioniq5" }, // the N too
      ioniq6: { body: "seal" }, // a long, low fastback, as the Seal is
      ioniq9: { body: "suv" },
      ioniq: { body: "hatch" }, // the first Ioniq Electric
      kona: { body: "atto3" }, // a small SUV of the Atto 3's size
      inster: { body: "hatch" },
    },
    other: { body: "suv" },
  },
  kia: {
    models: {
      ev3: { body: "atto3" },
      ev4: { body: "sedan" },
      ev5: { body: "suv" },
      ev6: { body: "sealion7" }, // a sleek, low crossover
      ev9: { body: "suv" },
      niro: { body: "atto3" },
      soul: { body: "hatch" },
    },
    other: { body: "suv" },
  },
  genesis: {
    models: {
      gv60: { body: "sealion7" },
      gv70: { body: "suv" },
      g80: { body: "sedan" },
    },
    other: { body: "suv" },
  },
};

/** A make the table doesn't know: an SUV. */
const OTHER: MakeLooks = { models: {}, other: { body: "suv" } };

const key = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * How a car of this make and model is drawn, and whether the shape is the model's own (`known`) or only its make's
 * usual one (a dashboard car's chosen shape is drawn instead, then).
 */
export function lookOf(
  make: string | null | undefined,
  model: string | null | undefined,
): CarLook & { known: boolean } {
  const brand = LOOKS[key(make)] ?? OTHER;
  const name = key(model);
  const match = Object.keys(brand.models)
    .filter((m) => name.startsWith(m))
    .sort((a, b) => b.length - a.length)[0];
  return { ...(match ? brand.models[match] : brand.other), known: !!match };
}
