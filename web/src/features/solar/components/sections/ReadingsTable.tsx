import { useId } from "react";
import { hhmm } from "~/features/common/formatting/utils/date";
import { DASH } from "~/features/common/formatting/utils/number";
import type { SystemInfo } from "~/features/common/live/types";
import type { HistorySeries } from "~/features/common/readings/types";
import { cn } from "~/features/common/ui/utils";
import { STRING_COLORS, signed } from "~/features/solar/utils/sections";

/** A column of the table: the group it sits under, its own heading, and how a reading in it reads. */
type Column = { key: string; group: string; head: string; color?: string; cell: (i: number) => string };

/** The fields a day's readings are fetched with, for the table. */
export const READING_FIELDS = [
  "pv_power",
  "pv1_power",
  "pv2_power",
  "mppt1_v",
  "mppt1_a",
  "mppt2_v",
  "mppt2_a",
  "load_power",
  "battery_power",
  "battery_soc",
  "grid_power",
  "inverter_temp",
  "pv2_temp",
];

/**
 * The table's columns for a day, leaving out any the day has no readings for (a system without a battery, a string
 * not connected). Power in kW to two places, so a column lines up whatever its size; volts whole, amps to one place.
 */
export function readingColumns(series: HistorySeries, s: SystemInfo | undefined): Column[] {
  const has = (f: string) => (series[f] ?? []).some((v) => v != null);
  const num =
    (f: string, digits: number, scale = 1) =>
    (i: number) => {
      const v = series[f]?.[i];
      return v == null ? DASH : signed(v / scale, digits);
    };
  const cols: Column[] = [];
  const add = (f: string, c: Omit<Column, "key" | "cell">, digits: number, scale = 1) => {
    if (has(f)) cols.push({ key: f, ...c, cell: num(f, digits, scale) });
  };
  const two = s?.pv2 != null;
  const main = s?.model ?? "Hybrid";
  const second = s?.pv2?.model ?? s?.pv2?.brand ?? "Second";
  add("pv_power", { group: "Solar", head: two ? "All kW" : "kW" }, 2, 1000);
  if (two) {
    add("pv1_power", { group: "Solar", head: `${main} kW` }, 2, 1000);
    add("pv2_power", { group: "Solar", head: `${second} kW` }, 2, 1000);
  }
  [1, 2].forEach((n, k) => {
    const v = series[`mppt${n}_v`];
    const a = series[`mppt${n}_a`];
    if (!v?.some((x) => x != null && x > 0)) return;
    const group = `String ${n}`;
    const color = STRING_COLORS[k];
    cols.push({ key: `s${n}v`, group, head: "V", color, cell: num(`mppt${n}_v`, 0) });
    cols.push({ key: `s${n}a`, group, head: "A", color, cell: num(`mppt${n}_a`, 1) });
    cols.push({
      key: `s${n}w`,
      group,
      head: "kW",
      color,
      cell: (i) => (v[i] != null && a?.[i] != null ? signed((v[i]! * a[i]!) / 1000, 2) : DASH),
    });
  });
  add("load_power", { group: "Home", head: "kW" }, 2, 1000);
  add("battery_power", { group: "Battery", head: "kW" }, 2, 1000);
  add("battery_soc", { group: "Battery", head: "%" }, 0);
  add("grid_power", { group: "Grid", head: "kW" }, 2, 1000);
  add("inverter_temp", { group: "Heat", head: two ? `${main} °C` : "Inverter °C" }, 0);
  if (two) add("pv2_temp", { group: "Heat", head: `${second} °C` }, 0);
  return cols;
}

/**
 * The day's readings as a table, a row each 5 minutes: the rows from `from` to `to` (indexes into the series), the
 * chosen one picked out. Choosing a row's time moves the chosen moment there. Wide, so it scrolls sideways in its own
 * box on a phone rather than the page.
 */
export function ReadingsTable({
  series,
  columns,
  from,
  to,
  chosen,
  onChoose,
}: {
  series: HistorySeries;
  columns: Column[];
  from: number;
  to: number;
  chosen: number | null;
  onChoose: (t: number) => void;
}) {
  const caption = useId();
  // Each group once, over the columns it spans.
  const groups: { name: string; span: number; color?: string }[] = [];
  for (const c of columns) {
    const g = groups[groups.length - 1];
    if (g && g.name === c.group) g.span++;
    else groups.push({ name: c.group, span: 1, color: c.color });
  }
  const rows = series.t.slice(from, to + 1).map((t, k) => ({ t, i: from + k }));
  return (
    <div className="-mx-2 overflow-x-auto px-2">
      <table aria-describedby={caption} className="w-full border-collapse text-[13px] tabular-nums">
        <caption id={caption} className="sr-only">
          Readings every 5 minutes. Choose a time to move the chart to it.
        </caption>
        <thead>
          <tr className="text-xs text-ink-muted">
            <th scope="col" rowSpan={2} className="pr-4 pb-2 text-left align-bottom font-normal">
              Time
            </th>
            {groups.map((g, k) => (
              <th
                key={`${g.name}${k}`}
                scope="colgroup"
                colSpan={g.span}
                className="border-l border-line-subtle pt-1 pl-4 text-right font-medium whitespace-nowrap text-ink"
              >
                <span className="inline-flex items-center gap-1.5">
                  {g.color && <span aria-hidden className="size-2 rounded-full" style={{ background: g.color }} />}
                  {g.name}
                </span>
              </th>
            ))}
          </tr>
          <tr className="text-xs text-ink-muted">
            {columns.map((c, k) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  "pb-2 pl-4 text-right font-normal whitespace-nowrap",
                  (k === 0 || columns[k - 1].group !== c.group) && "border-l border-line-subtle",
                )}
              >
                {c.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ t, i }) => {
            const on = i === chosen;
            return (
              <tr key={t} className={cn("border-t border-line-subtle", on && "bg-fg/6")}>
                <th scope="row" className="py-0 pr-4 text-left font-normal">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => onChoose(t)}
                    className={cn(
                      "w-full border-0 bg-transparent py-2 text-left whitespace-nowrap tabular-nums",
                      on ? "font-medium text-ink" : "text-ink-muted hover:text-ink",
                    )}
                  >
                    {hhmm(t)}
                  </button>
                </th>
                {columns.map((c, k) => {
                  const v = c.cell(i);
                  return (
                    <td
                      key={c.key}
                      className={cn(
                        "py-2 pl-4 text-right whitespace-nowrap",
                        (k === 0 || columns[k - 1].group !== c.group) && "border-l border-line-subtle",
                        v === DASH ? "text-ink-faint" : "text-ink",
                      )}
                    >
                      {v}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
