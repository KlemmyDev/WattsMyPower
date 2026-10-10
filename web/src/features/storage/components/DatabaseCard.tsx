import { useId, useState, type ReactNode } from "react";
import { hhmm, longDate } from "~/features/common/formatting/utils/date";
import { intAU, plural } from "~/features/common/formatting/utils/number";
import { DataRow } from "~/features/common/ui/components/DataRow";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { cn } from "~/features/common/ui/utils";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Card } from "~/features/common/ui/components/Card";
import type { MeasuredDatabase, StorageDatabase, StorageGroup, StorageTable } from "~/features/storage/types";
import { bytes, compact, share } from "~/features/storage/utils";

/** "Today 14:05", or "3 July 2026". */
function when(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toDateString() === new Date().toDateString() ? `Today ${hhmm(ts)}` : longDate.format(d);
}

/** One database: where it is, what it's made of, then its tables by group, each opening to show everything known about it. */
export function DatabaseCard({ db }: { db: StorageDatabase }) {
  const titleId = `h-db-${db.id}`;
  const color = db.id === "collector" ? COLOR.teal : COLOR.battery;
  const head = (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-[min(100%,18rem)] flex-1 items-center gap-4">
        <span
          className="flex size-12 flex-none items-center justify-center rounded-2xl"
          style={{ background: alpha(color, 0.16), color }}
        >
          <Icon name={db.id === "collector" ? "pulse" : "database"} size={22} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={titleId}>{db.name}</h2>
          <span className="text-[13px] leading-5 text-pretty text-ink-muted">{db.about}</span>
        </div>
      </div>
      {db.available && (
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[28px] leading-8 font-light tracking-[-0.6px] tabular-nums">
            {bytes(db.total_bytes)}
          </span>
          <span className="text-xs text-ink-muted">
            {intAU(db.rows)} {plural(db.rows, "row")}
          </span>
        </div>
      )}
    </div>
  );

  if (!db.available)
    return (
      <Card aria-labelledby={titleId}>
        {head}
        <Notice tone="warn">{db.error}</Notice>
      </Card>
    );

  const used = db.groups.filter((g) => g.rows > 0 || g.id === "sqlite");
  const unused = db.groups.filter((g) => !used.includes(g));
  const measuredTotal = db.groups.reduce((s, g) => s + (g.bytes ?? 0), 0);
  return (
    <Card aria-labelledby={titleId}>
      {head}
      <div className="flex flex-wrap gap-1.5 text-xs text-ink-muted">
        <Chip mono>{db.path}</Chip>
        <Chip>{`SQLite ${db.sqlite_version}`}</Chip>
        <Chip>{`Schema version ${db.schema_version}`}</Chip>
        <Chip>{`${bytes(db.page_size)} pages`}</Chip>
        <Chip>{`${db.journal_mode.toUpperCase()} journal`}</Chip>
      </div>
      {!db.measured && (
        <Notice tone="info">
          This server's SQLite can't measure each table's size, so only row counts are shown. The file sizes below are
          exact.
        </Notice>
      )}
      {used.map((g) => (
        <Group key={g.id} group={g} total={measuredTotal} />
      ))}
      {unused.length > 0 && (
        <div className="px-1 text-[13px] leading-5 text-ink-muted">
          <span className="font-medium text-ink">Not in use yet: </span>
          {unused.map((g) => g.name).join(", ")}.{" "}
          {db.measured &&
            `Their ${unused.reduce((s, g) => s + g.tables.length, 0)} empty tables take ${bytes(unused.reduce((s, g) => s + (g.bytes ?? 0), 0))}, a page or two each.`}
        </div>
      )}
      <Files db={db} />
    </Card>
  );
}

/** A fact about the database in a small pill. */
function Chip({ mono, children }: { mono?: boolean; children: string }) {
  return (
    <span
      title={mono ? children : undefined}
      className={cn(
        "max-w-full truncate rounded-full bg-canvas/60 px-2.5 py-1 light:bg-canvas",
        mono && "font-mono text-ink-body",
      )}
    >
      {children}
    </span>
  );
}

function Group({ group, total }: { group: StorageGroup; total: number }) {
  return (
    <section aria-label={group.name} className="overflow-hidden rounded-2xl bg-canvas/60 light:bg-canvas">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 px-5 pt-4 pb-3 max-sm:px-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-[15px] font-semibold">{group.name}</h3>
          <span className="text-[13px] text-ink-muted">{group.about}</span>
        </div>
        {group.bytes != null && (
          <span className="text-[13px] text-ink-muted tabular-nums">
            <span className="font-semibold text-ink">{bytes(group.bytes)}</span> · {share(group.bytes, total)} of this
            database
          </span>
        )}
      </div>
      {group.tables.map((t) => (
        <TableRow key={t.name} table={t} total={total} />
      ))}
    </section>
  );
}

/** A table: what it holds, its rows and size, and a bar of its share of the database. Opens to its details. */
function TableRow({ table: t, total }: { table: StorageTable; total: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const empty = t.rows === 0;
  return (
    <div className="border-t border-line-subtle">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="grid w-full cursor-pointer grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 border-0 bg-transparent px-5 py-3.5 text-left text-ink transition-colors hover:bg-surface-inset max-sm:px-4 md:grid-cols-[minmax(0,1fr)_110px_180px_20px]"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold">{t.label}</span>
            <code className="font-mono text-[11px] text-ink-faint">{t.name}</code>
          </span>
          {t.about && <span className="text-[13px] leading-5 text-ink-muted">{t.about}</span>}
        </span>
        <span className="text-right text-[13px] text-ink-muted tabular-nums max-md:hidden">
          {t.rows == null ? "" : empty ? "Empty" : `${intAU(t.rows)} ${plural(t.rows, "row")}`}
        </span>
        <span className="flex flex-col items-end gap-1.5 max-md:col-start-2 max-md:row-start-1">
          <span className={cn("text-sm font-semibold tabular-nums", empty && "font-normal text-ink-faint")}>
            {bytes(t.bytes)}
          </span>
          {t.bytes != null && (
            <span aria-hidden className="h-1 w-full overflow-hidden rounded-full bg-track max-md:w-20">
              <span
                className="block h-full rounded-full"
                style={{ width: `${total ? Math.max((t.bytes / total) * 100, 1) : 0}%`, background: COLOR.teal }}
              />
            </span>
          )}
        </span>
        <span aria-hidden className="max-md:hidden">
          <Icon
            name="chevD"
            size={18}
            className={cn("text-ink-muted transition-transform duration-200", open && "rotate-180")}
          />
        </span>
      </button>
      {open && (
        <div id={id} className="flex animate-pop flex-col gap-5 px-5 pb-5 max-sm:px-4">
          <TableDetails table={t} total={total} />
        </div>
      )}
    </div>
  );
}

function growthText(t: StorageTable): string | null {
  if (t.bytes_per_day == null) return t.rows_per_day === 0 ? "Nothing added in the last week" : null;
  if (t.growing_per_day === 0) return `Steady at about ${bytes(t.bytes)}: old rows go as new ones come`;
  return `About ${bytes(t.bytes_per_day)} a day, ${bytes(t.bytes_per_day * 30)} a month`;
}

function TableDetails({ table: t, total }: { table: StorageTable; total: number }) {
  const growth = growthText(t);
  const unusedPct = t.unused_bytes != null && t.data_bytes ? share(t.unused_bytes, t.data_bytes) : null;
  const smallTable = (t.bytes ?? 0) < 64 * 1024;
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-x-8">
        <Facts title="Size">
          <DataRow label="On disk">
            {bytes(t.bytes)}
            {t.bytes != null && <span className="font-normal text-ink-muted"> · {share(t.bytes, total)}</span>}
          </DataRow>
          <DataRow label="Table">{bytes(t.data_bytes)}</DataRow>
          <DataRow label="Indexes" muted={!t.indexes.length}>
            {t.indexes.length ? bytes(t.index_bytes) : "None"}
          </DataRow>
          {t.unused_bytes != null && (
            <DataRow label="Unused inside its pages" muted={!t.unused_bytes}>
              {bytes(t.unused_bytes)}
              {unusedPct && <span className="font-normal text-ink-muted"> · {unusedPct} of the table</span>}
            </DataRow>
          )}
          {t.pages != null && <DataRow label="Pages">{intAU(t.pages)}</DataRow>}
          {t.bytes_per_row != null && t.rows != null && t.rows >= 50 && (
            <DataRow label="Per row, on average">{bytes(t.bytes_per_row)}</DataRow>
          )}
        </Facts>
        <Facts title="Over time">
          {t.rows != null && <DataRow label="Rows">{intAU(t.rows)}</DataRow>}
          {t.oldest != null && <DataRow label="Oldest">{when(t.oldest)}</DataRow>}
          {t.newest != null && <DataRow label="Newest">{when(t.newest)}</DataRow>}
          <DataRow label="Kept">{t.kept}</DataRow>
          {t.rows_per_day != null && t.rows_per_day > 0 && (
            <DataRow label="Added">
              {t.rows_per_day >= 10 ? compact(t.rows_per_day) : t.rows_per_day} rows a day
            </DataRow>
          )}
          {growth && <DataRow label="Growth">{growth}</DataRow>}
          {t.limit_bytes != null && t.growing_per_day !== 0 && (
            <DataRow label="Levels off at">About {bytes(t.limit_bytes)}</DataRow>
          )}
        </Facts>
      </div>
      {t.parts.length > 0 && (
        <Facts title="What's in it">
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0 pt-2">
            {t.parts.map((p) => (
              <li
                key={p.label}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[minmax(0,1fr)_120px_96px_80px]"
              >
                <span className="truncate">{p.label}</span>
                <span className="text-right text-ink-muted tabular-nums max-sm:hidden">
                  {intAU(p.rows)} {plural(p.rows, "row")}
                </span>
                <span aria-hidden className="h-1 overflow-hidden rounded-full bg-track max-sm:hidden">
                  <span className="block h-full rounded-full bg-ink-muted" style={{ width: `${p.share * 100}%` }} />
                </span>
                <span className="text-right font-medium tabular-nums">
                  {smallTable || p.bytes == null ? share(p.share, 1) : `~${bytes(p.bytes)}`}
                </span>
              </li>
            ))}
          </ul>
        </Facts>
      )}
      {t.indexes.length > 0 && (
        <Facts title="Indexes" note="Kept alongside the table so looking rows up is quick.">
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 pt-2">
            {t.indexes.map((i) => (
              <li key={i.name} className="flex items-baseline justify-between gap-4 text-[13px]">
                <span className="min-w-0 truncate">
                  <code className="font-mono text-xs">{i.name}</code>
                  {i.name.startsWith("sqlite_autoindex_") && (
                    <span className="text-ink-muted"> · the table's key, made by SQLite</span>
                  )}
                </span>
                <span className="font-medium tabular-nums">{bytes(i.bytes)}</span>
              </li>
            ))}
          </ul>
        </Facts>
      )}
      {t.columns.length > 0 && (
        <Facts title={`${t.columns.length} ${plural(t.columns.length, "column")}`}>
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0 pt-2">
            {t.columns.map((c) => (
              <li key={c.name} className="rounded-md bg-canvas px-2 py-1 font-mono text-[11px] text-ink-body">
                {c.name}
                {c.type && <span className="text-ink-faint"> {c.type.toLowerCase()}</span>}
              </li>
            ))}
          </ul>
        </Facts>
      )}
    </>
  );
}

function Facts({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <h4 className="text-xs font-semibold tracking-wide text-ink-label uppercase">{title}</h4>
      {note && <p className="m-0 mt-1 text-xs text-ink-muted">{note}</p>}
      {children}
    </div>
  );
}

/** The database's files, and the space inside them no table is using. */
function Files({ db }: { db: MeasuredDatabase }) {
  const files: [string, number, string][] = [
    ["Database file", db.files.database, "The tables and indexes above, in pages of " + bytes(db.page_size) + "."],
    ["Write-ahead log", db.files.wal, "Recent writes, folded into the database file every so often."],
    ["Shared-memory index", db.files.shm, "The log's index, so readers can find recent writes."],
    ["Empty pages", db.free_bytes, "Inside the database file: left by deleted rows, and reused as rows are added."],
  ];
  return (
    <div>
      <dl className="m-0 grid grid-cols-2 gap-2 xl:grid-cols-4">
        {files.map(([label, size, about]) => (
          <div key={label} className="flex min-w-0 flex-col gap-1 rounded-2xl bg-canvas/60 p-4 light:bg-canvas">
            <dt className="text-xs text-ink-muted">{label}</dt>
            <dd className="m-0 flex flex-col gap-1">
              <span className="text-[15px] font-medium tabular-nums">{bytes(size)}</span>
              <span className="text-xs leading-4 text-ink-faint">{about}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
