import { store, STORE_DISPLAY } from "~/features/common/storage/utils";

/*
 * How the dashboard is shown in this browser, from Settings → Account → Display: its size, how
 * compact its layout is, stronger text contrast, and whether it animates. Each is an attribute on
 * <html> that styles/app.css acts on:
 *   data-size      zooms the whole page (text, spacing and charts together), smaller to larger
 *   data-density   "compact" tightens cards, gaps and charts (the `compact:` variant)
 *   data-contrast  "more" brings muted text and lines closer to the main text colour
 *   data-motion    "reduce" stops animations and transitions, as the device's own setting does
 */

export type Size = "small" | "default" | "large" | "larger";
export type Density = "comfortable" | "compact";
export type Display = { size: Size; density: Density; contrast: "default" | "more"; motion: "system" | "reduce" };

export const DEFAULT_DISPLAY: Display = {
  size: "default",
  density: "comfortable",
  contrast: "default",
  motion: "system",
};

export const SIZE_OPTIONS: { value: Size; label: string }[] = [
  { value: "small", label: "Smaller" },
  { value: "default", label: "Default" },
  { value: "large", label: "Large" },
  { value: "larger", label: "Larger" },
];

export const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
];

const ALLOWED: { [K in keyof Display]: readonly Display[K][] } = {
  size: ["small", "default", "large", "larger"],
  density: ["comfortable", "compact"],
  contrast: ["default", "more"],
  motion: ["system", "reduce"],
};

let cached: { raw: string; value: Display } | null = null;

/** This browser's choices, each falling back to the default if it's missing or unknown. */
export function savedDisplay(): Display {
  const raw = store.get(STORE_DISPLAY);
  if (cached?.raw === raw) return cached.value; // the same object while nothing changes (useSyncExternalStore)
  let parsed: Partial<Record<keyof Display, unknown>> = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    /* a damaged value: the defaults */
  }
  const value = Object.fromEntries(
    (Object.keys(ALLOWED) as (keyof Display)[]).map((k) => [
      k,
      (ALLOWED[k] as readonly unknown[]).includes(parsed[k]) ? parsed[k] : DEFAULT_DISPLAY[k],
    ]),
  ) as Display;
  cached = { raw, value };
  return value;
}

/** Put a set of choices on <html>. */
export function applyDisplay(d: Display = savedDisplay()) {
  const root = document.documentElement.dataset;
  root.size = d.size;
  root.density = d.density;
  root.contrast = d.contrast;
  root.motion = d.motion;
}

const listeners = new Set<() => void>();

/** Hear about choices saved here or in another tab (for useSyncExternalStore). */
export function subscribeDisplay(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const displayChanged = () => listeners.forEach((l) => l());

/** Change some of this browser's choices and show them. */
export function saveDisplay(change: Partial<Display>) {
  const next = { ...savedDisplay(), ...change };
  store.set(STORE_DISPLAY, JSON.stringify(next));
  applyDisplay(next);
  displayChanged();
}

/** Whether to hold still: the device asks for less motion, or this browser was set to. */
export const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduce";

/**
 * applyDisplay for the document head (routes/__root.tsx), so the page first paints at the chosen size
 * and layout. It runs before the app's modules, so it repeats the logic: keep the two in step.
 */
export const DISPLAY_SCRIPT = `(() => {
  let d = {};
  try {
    d = JSON.parse(localStorage.getItem("${STORE_DISPLAY}") || "{}") || {};
  } catch {}
  const allowed = ${JSON.stringify(ALLOWED)};
  const fallback = ${JSON.stringify(DEFAULT_DISPLAY)};
  for (const k of Object.keys(allowed))
    document.documentElement.dataset[k] = allowed[k].includes(d[k]) ? d[k] : fallback[k];
})();`;
