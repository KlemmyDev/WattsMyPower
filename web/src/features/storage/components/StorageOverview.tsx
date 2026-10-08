import { useState } from "react";
import { hhmm } from "~/features/common/formatting/utils/date";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Button } from "~/features/common/ui/components/Button";
import { Swatch } from "~/features/common/ui/components/Swatch";
import { cn } from "~/features/common/ui/utils";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";
import type { MeasuredDatabase, StorageReport } from "~/features/storage/types";
import { bytes, compact, share } from "~/features/storage/utils";

/** The overview's kinds of data, in a fixed order and colour. Groups not named here count as "everything else". */
const KINDS = [
  { id: "registers", name: "Raw inverter registers", color: COLOR.teal },
  { id: "readings", name: "Readings", color: COLOR.battery },
  { id: "weather", name: "Weather and forecast", color: COLOR.solar },
  { id: "prices", name: "Electricity prices", color: COLOR.lilac },
  { id: "other", name: "Settings, alerts and the rest", color: COLOR.bar },
  { id: "overhead", name: "Logs and empty pages", color: COLOR.barFaint },
] as const;

type Kind = (typeof KINDS)[number]["id"];
const NAMED = new Set<string>(KINDS.map((k) => k.id));

/** How the files' bytes split between the kinds, across both databases. What no table holds (the write-ahead log, its
 * index, empty pages) is the overhead, so the parts add up to the files' size. */
function split(dbs: MeasuredDatabase[]): Record<Kind, number> {
  const out = Object.fromEntries(KINDS.map((k) => [k.id, 0])) as Record<Kind, number>;
  for (const db of dbs) {
    let inTables = 0;
    for (const g of db.groups) {
      const b = g.bytes ?? 0;
      out[(NAMED.has(g.id) && g.id !== "other" ? g.id : "other") as Kind] += b;
      inTables += b;
    }
    if (!db.measured) out.other += db.total_bytes;
    else out.overhead += Math.max(0, db.total_bytes - inTables);
  }
  return out;
}

/** Manage → Data, the top: how much is stored in all, what kinds of data take the room, and how fast it grows. */
export function StorageOverview({
  report,
  measuring,
  onMeasure,
}: {
  report: StorageReport;
  measuring: boolean;
  onMeasure: () => void;
}) {
  const dbs = report.databases.filter((d): d is MeasuredDatabase => d.available);
  const total = dbs.reduce((s, d) => s + d.total_bytes, 0);
  const parts = split(dbs);
  const growth = dbs.reduce((s, d) => s + d.growth_per_day, 0);
  const rows = dbs.reduce((s, d) => s + d.rows, 0);
  const empty = dbs.reduce((s, d) => s + d.free_bytes, 0);
  const of = (id: "dashboard" | "collector") => report.databases.find((d) => d.id === id);
  const size = (id: "dashboard" | "collector") => {
    const d = of(id);
    return d?.available ? bytes(d.total_bytes) : "Not available";
  };
  const tiles: [string, string][] = [
    ["Dashboard database", size("dashboard")],
    ["Collector database", size("collector")],
    ["Rows stored", compact(rows)],
    ["Growing by", growth > 0 ? `About ${bytes(growth * 30)} a month` : "Not growing"],
    ["Empty pages", bytes(empty)],
    ["Free on this drive", `${bytes(report.disk.free)} of ${bytes(report.disk.total)}`],
  ];

  return (
    <SettingsCard aria-labelledby="h-storage">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line-subtle p-6 max-sm:p-5">
        <SettingsTitle
          id="h-storage"
          title="What's stored"
          sub="WattsMyPower keeps everything on this server, in two SQLite databases. Here's what's in them, and how much room each part takes."
        />
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-ink-muted">Measured {hhmm(report.measured_at)}</span>
          <Button variant="outline" size="sm" onClick={onMeasure} disabled={measuring}>
            {measuring ? "Measuring…" : "Measure again"}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-5 border-b border-line-subtle p-6 max-sm:p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-display text-[34px] leading-none font-bold tabular-nums">{bytes(total)}</span>
          <span className="text-sm text-ink-muted">on disk, in {report.folder}</span>
        </div>
        <Breakdown parts={parts} total={total} />
      </div>
      <div className="overflow-hidden">
        <dl className="m-0 -mr-px -mb-px grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          {tiles.map(([label, value]) => (
            <div
              key={label}
              className="flex min-w-0 flex-col gap-1 border-r border-b border-line-subtle px-6 py-4 max-sm:px-5"
            >
              <dt className="text-xs text-ink-muted">{label}</dt>
              <dd className="m-0 text-[15px] font-medium break-words tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </SettingsCard>
  );
}

/** One bar split by kind, with a legend naming each part, its size and share. Hovering either lights both. */
function Breakdown({ parts, total }: { parts: Record<Kind, number>; total: number }) {
  const [hot, setHot] = useState<Kind | null>(null);
  const shown = KINDS.filter((k) => parts[k.id] > 0);
  const widths = shown.map((k) => (total ? (parts[k.id] / total) * 100 : 0));
  // Each part's middle (% from the left), where its tooltip points.
  const placed = shown.map((k, i) => {
    const left = widths.slice(0, i).reduce((s, w) => s + w, 0);
    return { ...k, width: widths[i], middle: left + widths[i] / 2 };
  });
  const tip = placed.find((k) => k.id === hot);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        {/* A 2px gap between parts; slivers keep a visible minimum so nothing that's there disappears. */}
        <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-[4px]" onMouseLeave={() => setHot(null)}>
          {placed.map((k) => (
            <div
              key={k.id}
              className="h-full min-w-[3px] cursor-pointer transition-opacity duration-200"
              style={{ flexGrow: k.width, flexBasis: 0, background: k.color, opacity: hot && hot !== k.id ? 0.35 : 1 }}
              onMouseEnter={() => setHot(k.id)}
            />
          ))}
        </div>
        {tip && (
          <div
            role="tooltip"
            className="pointer-events-none absolute bottom-full mb-2 -translate-x-1/2 rounded-lg bg-popover px-3 py-2 text-xs whitespace-nowrap shadow-[0_8px_24px_var(--color-shadow-pop)]"
            style={{ left: `clamp(80px, ${tip.middle}%, calc(100% - 80px))` }}
          >
            <div className="font-semibold">{tip.name}</div>
            <div className="text-ink-muted tabular-nums">
              {bytes(parts[tip.id])} · {share(parts[tip.id], total)}
            </div>
          </div>
        )}
      </div>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-x-6 gap-y-2 p-0">
        {placed.map((k) => (
          <li
            key={k.id}
            className={cn(
              "flex cursor-pointer items-center gap-2 text-[13px] transition-opacity duration-200",
              hot && hot !== k.id && "opacity-50",
            )}
            onMouseEnter={() => setHot(k.id)}
            onMouseLeave={() => setHot(null)}
          >
            <Swatch color={k.color} size={10} />
            <span className="min-w-0 flex-1 truncate">{k.name}</span>
            <span className="font-medium tabular-nums">{bytes(parts[k.id])}</span>
            <span className="w-9 text-right text-ink-muted tabular-nums">{share(parts[k.id], total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
