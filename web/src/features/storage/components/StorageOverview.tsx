import type { ReactNode } from "react";
import { hhmm } from "~/features/common/formatting/utils/date";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Button } from "~/features/common/ui/components/Button";
import { Swatch } from "~/features/common/ui/components/Swatch";
import { OptionList, OptionRow, SettingsSection } from "~/features/settings/components/SettingsSection";
import { StorageTreemap, type TreemapItem } from "~/features/storage/components/StorageTreemap";
import type { MeasuredDatabase, StorageReport } from "~/features/storage/types";
import { bytes, compact, share } from "~/features/storage/utils";

/** The kinds of data, in a fixed order and colour. Groups not named here count as "everything else". */
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
const colorOf = (k: Kind) => KINDS.find((x) => x.id === k)!.color;

const measured = (r: StorageReport) => r.databases.filter((d): d is MeasuredDatabase => d.available);

/**
 * Every table with something in it, across both databases, and what no table holds (the write-ahead log, its index,
 * empty pages) as one box a database, so the boxes add up to the files' size.
 */
function treemapItems(dbs: MeasuredDatabase[]): TreemapItem[] {
  const out: TreemapItem[] = [];
  for (const db of dbs) {
    let inTables = 0;
    for (const g of db.groups)
      for (const t of g.tables) {
        const b = t.bytes ?? 0;
        inTables += b;
        if (b > 0)
          out.push({
            key: `${db.id}.${t.name}`,
            label: t.label,
            where: `${db.name} · ${g.name}`,
            bytes: b,
            rows: t.rows,
            color: colorOf(kindOf(g.id)),
            quiet: kindOf(g.id) === "other",
          });
      }
    const rest = db.measured ? db.total_bytes - inTables : db.total_bytes;
    if (rest > 0)
      out.push({
        key: `${db.id}.overhead`,
        label: db.measured ? "Logs and empty pages" : db.name,
        where: db.name,
        bytes: rest,
        rows: null,
        color: colorOf(db.measured ? "overhead" : "other"),
        quiet: true,
      });
  }
  return out;
}

/** Settings → Data, the picture: what takes the room, table by table, as a treemap coloured by kind, with a legend. */
export function StorageVisual({
  report,
  measuring,
  onMeasure,
}: {
  report: StorageReport;
  measuring: boolean;
  onMeasure: () => void;
}) {
  const dbs = measured(report);
  const items = treemapItems(dbs);
  const total = items.reduce((s, i) => s + i.bytes, 0);
  const byKind = KINDS.map((k) => ({
    ...k,
    bytes: items.filter((i) => i.color === k.color).reduce((s, i) => s + i.bytes, 0),
  })).filter((k) => k.bytes > 0);
  return (
    <SettingsSection
      id="h-storage"
      title="What takes the room"
      sub={`${bytes(total)} on disk. Each box is a table, as big as its share; hover one for its details.`}
      aside={
        <Button variant="outline" size="sm" onClick={onMeasure} disabled={measuring}>
          {measuring ? "Measuring…" : "Measure again"}
        </Button>
      }
    >
      <StorageTreemap items={items} />
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-5 gap-y-1.5 p-0">
        {byKind.map((k) => (
          <li key={k.id} className="flex items-center gap-2 text-[13px]">
            <Swatch color={k.color} size={10} />
            <span className="min-w-0 flex-1 truncate">{k.name}</span>
            <span className="text-ink-muted tabular-nums">{share(k.bytes, total)}</span>
          </li>
        ))}
      </ul>
      <span className="text-xs text-ink-faint">Measured {hhmm(report.measured_at)}</span>
    </SettingsSection>
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
        <span>In 6 months · {bytes(months[6])}</span>
        <span>In a year · {bytes(months[12])}</span>
      </div>
    </div>
  );
}

/** Settings → Data, beside the picture: both databases' size, rows, growth and where it's heading, and the drive. */
export function StorageFacts({ report }: { report: StorageReport }) {
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
      id="h-storage-facts"
      title="Storage"
      sub="Everything stays on this server, in two SQLite databases."
    >
      <OptionList>
        <Fact label="On disk" help={`Dashboard ${size("dashboard")} · collector ${size("collector")}`}>
          {bytes(total)}
        </Fact>
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
    </SettingsSection>
  );
}
