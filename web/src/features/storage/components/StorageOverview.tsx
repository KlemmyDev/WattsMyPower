import { useState } from "react";
import { hhmm } from "~/features/common/formatting/utils/date";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Button } from "~/features/common/ui/components/Button";
import { SummaryCard, SummaryStat } from "~/features/common/ui/components/Summary";
import { Swatch } from "~/features/common/ui/components/Swatch";
import { cn } from "~/features/common/ui/utils";
import { SettingsSection } from "~/features/settings/components/SettingsSection";
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

/** Manage → Data, the top: how much is stored in all and how fast it grows, then what kinds of data take the room. */
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
    return d?.available ? bytes(d.total_bytes) : "not available";
  };

  return (
    <>
      <SummaryCard
        icon="database"
        color={COLOR.teal}
        label="Storage"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-4 text-[13px] text-ink-muted">
            <span className="min-w-0 flex-1 truncate">
              Measured {hhmm(report.measured_at)} ·{" "}
              <span title={report.folder} className="font-mono text-xs">
                {report.folder}
              </span>
            </span>
            <Button variant="outline" size="sm" onClick={onMeasure} disabled={measuring}>
              {measuring ? "Measuring…" : "Measure again"}
            </Button>
          </div>
        }
      >
        <SummaryStat
          label="On disk"
          value={bytes(total)}
          sub={`Dashboard ${size("dashboard")} · collector ${size("collector")}`}
        />
        <SummaryStat label="Rows stored" value={compact(rows)} sub="In both databases" />
        <SummaryStat
          label="Growing by"
          value={growth > 0 ? `${bytes(growth * 30)}` : "Not growing"}
          sub={growth > 0 ? "A month, at this week's rate" : "Old rows go as new ones come"}
        />
        <SummaryStat
          label="Free on this drive"
          value={bytes(report.disk.free)}
          sub={`Of ${bytes(report.disk.total)} · ${bytes(empty)} empty pages`}
        />
      </SummaryCard>
      <SettingsSection
        id="h-storage"
        title="What's stored"
        sub="Everything stays on this server, in two SQLite databases. Here's what takes the room."
      >
        <Breakdown parts={parts} total={total} />
      </SettingsSection>
    </>
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
        <div className="flex h-4 w-full gap-[3px] overflow-hidden rounded-full" onMouseLeave={() => setHot(null)}>
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
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-2 p-0">
        {placed.map((k) => (
          <li
            key={k.id}
            className={cn(
              "flex cursor-pointer items-center gap-2.5 rounded-xl bg-canvas/60 px-3 py-2.5 text-[13px] transition-opacity duration-200 light:bg-canvas",
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
