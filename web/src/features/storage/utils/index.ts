import { DASH } from "~/features/common/formatting/utils/number";

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** A size, in powers of 1024 as SQLite counts pages: "812 B", "4.0 KB", "38.2 MB", "1.4 GB". */
export function bytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  let v = Math.max(0, n);
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  if (i === 0) return `${Math.round(v)} B`;
  return `${v < 100 ? v.toFixed(1) : Math.round(v)} ${UNITS[i]}`;
}

/** A count, shortened: "812", "48.2K", "1.31M". */
export function compact(n: number): string {
  return new Intl.NumberFormat("en-AU", { notation: "compact", maximumFractionDigits: n >= 1e6 ? 2 : 1 }).format(n);
}

/** A share of a whole, "42%", or "<1%" for a sliver that isn't nothing. */
export function share(part: number, whole: number): string {
  if (!whole || part <= 0) return "0%";
  const p = (part / whole) * 100;
  return p < 1 ? "<1%" : `${Math.round(p)}%`;
}
