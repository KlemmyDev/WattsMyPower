/** Number and money formatting (en-AU). Missing values show as an em dash. */

const missing = (v: number | null | undefined): v is null | undefined => v == null || Number.isNaN(v);
export const DASH = "—";

/** Power from watts, as value and unit: watts below 1 kW ("395", "W"), else kW ("1.2", "kW"). Magnitude only. */
export function powerParts(w: number): [value: string, unit: "W" | "kW"] {
  const a = Math.abs(w);
  return Math.round(a) < 1000 ? [String(Math.round(a)), "W"] : [(a / 1000).toFixed(1), "kW"];
}
/** Watts as "395 W" or "1.2 kW" (magnitude only; direction is shown separately). */
export const kW = (w: number | null | undefined) => (missing(w) ? DASH : powerParts(w).join(" "));

/**
 * Energy from kWh, as value and unit: Wh below 1 kWh ("395", "Wh"), else kWh ("1.2", "kWh"). `whole`
 * rounds kWh to whole numbers with thousands separators ("1,013").
 */
export function energyParts(v: number, whole = false): [value: string, unit: "Wh" | "kWh"] {
  const a = Math.abs(v);
  const wh = Math.round(a * 1000);
  const sign = v < 0 && wh > 0 ? "-" : "";
  if (wh < 1000) return [`${sign}${wh}`, "Wh"];
  return [`${sign}${whole ? Math.round(a).toLocaleString("en-AU") : a.toFixed(1)}`, "kWh"];
}
/** kWh as "395 Wh" or "1.2 kWh". */
export const kWh = (v: number | null | undefined) => (missing(v) ? DASH : energyParts(v).join(" "));
/** kWh as "395 Wh" or "1,013 kWh". */
export const kWhInt = (v: number) => energyParts(v, true).join(" ");
/**
 * A true minus sign for a negative `v`, but only when `shown` (its magnitude as displayed) isn't zero: so
 * −0.001 shows as "$0.00", never "−$0.00".
 */
export const minus = (v: number, shown: string) => (v < 0 && /[1-9]/.test(shown) ? "−" : "");
/** "$1.23", or "−$1.23" for negatives. */
export function money(v: number | null | undefined) {
  if (missing(v)) return DASH;
  const shown = Math.abs(v).toFixed(2);
  return `${minus(v, shown)}$${shown}`;
}
/** Whole dollars with thousands separators: "$18,400". */
export function dollars(v: number | null | undefined) {
  if (missing(v)) return DASH;
  const shown = Math.round(Math.abs(v)).toLocaleString("en-AU");
  return `${minus(v, shown)}$${shown}`;
}
export const pct = (v: number | null | undefined) => (missing(v) ? DASH : `${Math.round(v)}%`);
/** A $/kWh rate in cents, trimmed: 0.325 → "32.5c", 0.3 → "30c". */
export const centsShort = (v: number) => `${+(v * 100).toFixed(1)}c`;
/** A $/kWh rate in cents, always one decimal: "32.5c". */
export const cents = (v: number | null | undefined) => (v == null ? DASH : `${(v * 100).toFixed(1)}c`);
export const intAU = (v: number) => Math.round(v).toLocaleString("en-AU");
export const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
