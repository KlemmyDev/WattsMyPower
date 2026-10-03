import type { ImportDay, ImportPreview } from "~/features/imports/types";

const add = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : a + b);

/** Several files' days as one list: a day split across files adds up. */
export function mergeDays(previews: ImportPreview[]): ImportDay[] {
  const byDate = new Map<string, ImportDay>();
  for (const p of previews)
    for (const d of p.days) {
      const was = byDate.get(d.date);
      byDate.set(
        d.date,
        was
          ? {
              date: d.date,
              buckets: was.buckets + d.buckets,
              new: was.new + d.new,
              replaces: was.replaces + d.replaces,
              recorded: was.recorded + d.recorded,
              locked: was.locked || d.locked,
              pv_kwh: add(was.pv_kwh, d.pv_kwh),
              load_kwh: add(was.load_kwh, d.load_kwh),
              import_kwh: add(was.import_kwh, d.import_kwh),
              export_kwh: add(was.export_kwh, d.export_kwh),
            }
          : d,
      );
    }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Whether importing replaces the day's recorded readings: when asked to, and before today. */
export const replacing = (d: ImportDay, replace: boolean) => replace && d.recorded > 0 && !d.locked;

/** 5-minute readings importing a day would write. */
export const toWriteOn = (d: ImportDay, replace: boolean) =>
  d.new + d.replaces + (replacing(d, replace) ? d.recorded : 0);

/** How a day would be imported, for its status pill. */
export function dayStatus(d: ImportDay, replace = false): { label: string; tone: "ok" | "neutral" | "brand" } {
  if (replacing(d, replace)) return { label: "Replaces recorded", tone: "brand" };
  if (d.recorded >= d.buckets) return { label: d.locked ? "Recording today" : "Already recorded", tone: "neutral" };
  if (d.recorded > 0) return { label: "Fills gaps", tone: "brand" };
  if (d.replaces > 0) return { label: "Replaces earlier import", tone: "brand" };
  return { label: "New", tone: "ok" };
}

/** "every 5 minutes", "every hour". */
export function intervalLabel(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m === 60) return "every hour";
  return m === 1 ? "every minute" : `every ${m} minutes`;
}

/** A stable key for a picked file. */
export const fileKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;
