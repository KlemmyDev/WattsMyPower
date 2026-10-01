/** Number and money formatting (en-AU). Missing values show as an em dash. */

const missing = (v: number | null | undefined): v is null | undefined => v == null || Number.isNaN(v);
export const DASH = "—";

/** Watts as "1.2 kW" (magnitude only; direction is shown separately). */
export const kW = (w: number | null | undefined) => (missing(w) ? DASH : `${(Math.abs(w) / 1000).toFixed(1)} kW`);
/** Watts as "1.2" (no unit). */
export const kWnum = (w: number | null | undefined) => (missing(w) ? DASH : (Math.abs(w) / 1000).toFixed(1));
export const kWh = (v: number | null | undefined) => (missing(v) ? DASH : `${v.toFixed(1)} kWh`);
export const kWhInt = (v: number) => `${Math.round(v).toLocaleString("en-AU")} kWh`;
/** "$1.23", or "−$1.23" for negatives. */
export const money = (v: number | null | undefined) =>
  missing(v) ? DASH : `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(2)}`;
/** Whole dollars with thousands separators: "$18,400". */
export const dollars = (v: number | null | undefined) =>
  missing(v) ? DASH : `${v < 0 ? "−" : ""}$${Math.round(Math.abs(v)).toLocaleString("en-AU")}`;
export const pct = (v: number | null | undefined) => (missing(v) ? DASH : `${Math.round(v)}%`);
/** A $/kWh rate in cents, trimmed: 0.325 → "32.5c", 0.3 → "30c". */
export const centsShort = (v: number) => `${+(v * 100).toFixed(1)}c`;
/** A $/kWh rate in cents, always one decimal: "32.5c". */
export const cents = (v: number | null | undefined) => (v == null ? DASH : `${(v * 100).toFixed(1)}c`);
export const intAU = (v: number) => Math.round(v).toLocaleString("en-AU");
export const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
