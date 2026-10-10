/** GET /api/storage: both databases, measured table by table (app/features/storage). Sizes are bytes. */

export type StoragePart = { label: string; rows: number; share: number; bytes: number | null };

export type StorageTable = {
  name: string;
  label: string;
  about: string;
  /** How long its rows are kept, in words. */
  kept: string;
  /** Null for SQLite's own schema. */
  rows: number | null;
  /** On disk, its indexes included. Null when SQLite can't measure tables. */
  bytes: number | null;
  data_bytes: number | null;
  index_bytes: number | null;
  payload_bytes: number | null;
  unused_bytes: number | null;
  pages: number | null;
  bytes_per_row: number | null;
  /** Unix seconds: the oldest and newest rows dated up to now. */
  oldest: number | null;
  newest: number | null;
  /** Over the last week, for tables that fill as time passes. */
  rows_per_day: number | null;
  bytes_per_day: number | null;
  /** 0 once it's at its limit (rows past retention are deleted as new ones come). */
  growing_per_day: number | null;
  /** Where it stops growing, at today's rate. */
  limit_bytes: number | null;
  parts: StoragePart[];
  columns: { name: string; type: string }[];
  indexes: { name: string; bytes: number | null }[];
};

export type StorageGroup = {
  id: string;
  name: string;
  about: string;
  bytes: number | null;
  rows: number;
  tables: StorageTable[];
};

type DatabaseHead = { id: "dashboard" | "collector"; name: string; about: string };

export type MeasuredDatabase = DatabaseHead & {
  available: true;
  path: string;
  files: { database: number; wal: number; shm: number };
  total_bytes: number;
  page_size: number;
  pages: number;
  /** Pages left empty by deleted rows: reused as rows are added. */
  free_bytes: number;
  schema_version: number;
  sqlite_version: string;
  journal_mode: string;
  /** False when this SQLite can't measure each table (sizes are then null). */
  measured: boolean;
  rows: number;
  growth_per_day: number;
  groups: StorageGroup[];
};

export type StorageDatabase = MeasuredDatabase | (DatabaseHead & { available: false; error: string });

export type StorageReport = {
  measured_at: number;
  folder: string;
  disk: { total: number; free: number };
  databases: StorageDatabase[];
};

/** A backup downloaded (GET /api/storage/backup): the zip's name and size, and why the collector's database isn't in
 * it when it was asked for. */
export type BackupSaved = { name: string; bytes: number; skipped: string | null };

/** How far along a backup is: being made on the server, then coming down (`total` unknown without a length). */
export type BackupProgress = { stage: "making" } | { stage: "downloading"; received: number; total: number | null };
