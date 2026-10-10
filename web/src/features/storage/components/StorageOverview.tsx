import type { ReactNode } from "react";
import { hhmm } from "~/features/common/formatting/utils/date";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Button } from "~/features/common/ui/components/Button";
import { useBarHover } from "~/features/common/ui/components/ChartHover";
import { Swatch } from "~/features/common/ui/components/Swatch";
import { cn } from "~/features/common/ui/utils";
import { OptionList, OptionRow, SettingsSection } from "~/features/settings/components/SettingsSection";
import type { MeasuredDatabase, StorageReport } from "~/features/storage/types";
import { bytes, compact, share } from "~/features/storage/utils";

/** The kinds of data, each in its own colour. Groups not named here count as "settings and the rest". */
const KINDS = [
  { id: "registers", name: "Raw inverter registers", color: COLOR.teal },
  { id: "readings", name: "Readings", color: COLOR.battery },
  { id: "weather", name: "Weather and forecast", color: COLOR.solar },
  { id: "prices", name: "Electricity prices", color: COLOR.lilac },
  { id: "other", name: "Settings and the rest", color: COLOR.gridSoft },
  { id: "overhead", name: "Logs and empty pages", color: COLOR.bar },
] as const;

type Kind = (typeof KINDS)[number]["id"];
const NAMED = new Set<string>(KINDS.map((k) => k.id));
const kindOf = (group: string): Kind => (NAMED.has(group) && group !== "overhead" ? (group as Kind) : "other");

const measured = (r: StorageReport) => r.databases.filter((d): d is MeasuredDatabase => d.available);

type Slice = (typeof KINDS)[number] & { bytes: number };

/**
 * How much room each kind of data takes across both databases, largest first. What no table holds (the write-ahead
 * log, its index, empty pages) is one more part, so the parts add up to the files' size.
 */
function slices(dbs: MeasuredDatabase[]): Slice[] {
  const room = new Map<Kind, number>();
  const add = (k: Kind, b: number) => b > 0 && room.set(k, (room.get(k) ?? 0) + b);
  for (const db of dbs) {
    let inTables = 0;
    for (const g of db.groups) {
      const b = g.tables.reduce((s, t) => s + (t.bytes ?? 0), 0);
      inTables += b;
      add(kindOf(g.id), b);
    }
    // A database that can't measure its tables is all "the rest".
    add(db.measured ? "overhead" : "other", db.total_bytes - inTables);
  }
  return KINDS.map((k) => ({ ...k, bytes: room.get(k.id) ?? 0 }))
    .filter((k) => k.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
}

/**
 * What takes the room: one thin bar split by kind of data, and a line for each kind under it with its share and size.
 * Pointing at a part, on the bar or its line, lights it and fades the rest.
 */
function RoomBar({ parts, total }: { parts: Slice[]; total: number }) {
  const { hover, plot, bar } = useBarHover<Kind>();
  const lit = (k: Kind) => hover == null || hover === k;
  return (
    <div className="flex flex-col gap-3" {...plot}>
      <div className="flex h-2.5 gap-0.5" role="img" aria-label="What takes the room in the databases">
        {parts.map((p) => (
          <span
            key={p.id}
            {...bar(p.id)}
            title={`${p.name}: ${bytes(p.bytes)}`}
            className={cn(
              "h-full min-w-1 transition-[opacity,scale] duration-300 ease-out-soft first:rounded-l-full last:rounded-r-full",
              !lit(p.id) && "opacity-30",
              hover === p.id && "scale-y-150",
            )}
            style={{ flexGrow: p.bytes, background: p.color }}
          />
        ))}
      </div>
      <ul className="-mx-2.5 flex flex-col">
        {parts.map((p) => (
          <li
            key={p.id}
            tabIndex={0}
            {...bar(p.id)}
            className={cn(
              "flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1 text-[13.5px] transition-[background-color,opacity] duration-200 outline-none",
              hover === p.id && "bg-fg/5",
              !lit(p.id) && "opacity-55",
            )}
          >
            <Swatch color={p.color} shape="dot" />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className="text-ink-faint tabular-nums">{share(p.bytes, total)}</span>
            <span className="w-16 text-right tabular-nums">{bytes(p.bytes)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A fact in the storage list: its name and a line under it, the figure on the right. */
function Fact({ label, help, children }: { label: string; help?: ReactNode; children: ReactNode }) {
  return (
    <OptionRow label={label} help={help}>
      <span className="text-right text-[15px] text-ink-muted tabular-nums">{children}</span>
    </OptionRow>
  );
}

/**
 * Where it's heading: the databases' size from now to a year on at this week's rate, as a line (tables that keep a
 * fixed window stop growing, so it's the most it could be).
 */
function Projection({ now, perDay }: { now: number; perDay: number }) {
  const months = Array.from({ length: 13 }, (_, m) => now + perDay * 30.4 * m);
  const max = months[12] || 1;
  const W = 240;
  const H = 56;
  const pts = months.map((v, m) => [(m / 12) * W, H - (v / max) * (H - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <div className="flex flex-col gap-1.5 px-4 pb-4">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-14 w-full" aria-hidden>
        <path d={`${line} L${W},${H} L0,${H} Z`} fill={alpha(COLOR.teal, 0.16)} />
        <path d={line} fill="none" stroke={COLOR.teal} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[11px] text-ink-faint tabular-nums">
        <span>Now · {bytes(now)}</span>
        <span className="max-sm:hidden">In 6 months · {bytes(months[6])}</span>
        <span>In a year · {bytes(months[12])}</span>
      </div>
    </div>
  );
}

/**
 * Settings → Data, the overview: how much is on disk and what takes the room, then the rows, growth and where it's
 * heading, and the drive it's on.
 */
export function StorageSummary({
  report,
  measuring,
  onMeasure,
}: {
  report: StorageReport;
  measuring: boolean;
  onMeasure: () => void;
}) {
  const dbs = measured(report);
  const total = dbs.reduce((s, d) => s + d.total_bytes, 0);
  const growth = dbs.reduce((s, d) => s + d.growth_per_day, 0);
  const rows = dbs.reduce((s, d) => s + d.rows, 0);
  const empty = dbs.reduce((s, d) => s + d.free_bytes, 0);
  const size = (id: "dashboard" | "collector") => {
    const d = report.databases.find((x) => x.id === id);
    return d?.available ? bytes(d.total_bytes) : "not available";
  };
  const used = report.disk.total - report.disk.free;
  return (
    <SettingsSection
      id="h-storage"
      title="What takes the room"
      sub="Everything stays on this server, in two SQLite databases."
      aside={
        <Button variant="outline" size="sm" onClick={onMeasure} disabled={measuring}>
          {measuring ? "Measuring…" : "Measure again"}
        </Button>
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-[28px] leading-8 font-light tracking-[-0.6px] tabular-nums">{bytes(total)}</span>
        <span className="text-[13px] text-ink-muted">
          Dashboard {size("dashboard")} · collector {size("collector")}
        </span>
      </div>
      <RoomBar parts={slices(dbs)} total={total} />
      <OptionList>
        <Fact label="Rows stored">{compact(rows)}</Fact>
        <Fact label="Empty pages" help="Left by deleted rows, and used again as rows are added.">
          {bytes(empty)}
        </Fact>
        <div>
          <Fact label="Growing by" help="A month, at this week's rate.">
            {growth > 0 ? bytes(growth * 30) : "Not growing"}
          </Fact>
          {growth > 0 && <Projection now={total} perDay={growth} />}
        </div>
        <div>
          <Fact label="Free on this drive" help={`Of ${bytes(report.disk.total)}`}>
            {bytes(report.disk.free)}
          </Fact>
          <div className="px-4 pb-4">
            <div className="flex h-2 gap-[2px] overflow-hidden rounded-full bg-track" title={`${bytes(used)} used`}>
              <span
                className="h-full"
                style={{ width: `${(used / report.disk.total) * 100}%`, background: COLOR.bar }}
              />
            </div>
          </div>
        </div>
      </OptionList>
      <span className="text-xs text-ink-faint">Measured {hhmm(report.measured_at)}</span>
    </SettingsSection>
  );
}
