/** A column in an uploaded export, and what it was matched to (a key of ImportPreview.fields). */
export type ImportColumn = { header: string; field: string | null; unit: string | null };

/** What one day of an export holds, and what importing it would do to the 5-minute buckets. */
export type ImportDay = {
  date: string;
  buckets: number;
  /** Buckets with nothing recorded yet. */
  new: number;
  /** Buckets an earlier import wrote, which this one replaces. */
  replaces: number;
  /** Buckets WattsMyPower recorded itself: kept as they are. */
  recorded: number;
  pv_kwh: number | null;
  load_kwh: number | null;
  import_kwh: number | null;
  export_kwh: number | null;
};

export type ImportPreview = {
  name: string;
  columns: ImportColumn[];
  /** Field -> the headers summed for it. */
  mapping: Record<string, string[]>;
  /** Field -> its label, in display order. */
  fields: Record<string, string>;
  /** Seconds between readings. */
  interval: number;
  first_ts: number;
  last_ts: number;
  days: ImportDay[];
  buckets: number;
  new: number;
  replaces: number;
  recorded: number;
  warnings: string[];
};

export type ImportResult = ImportPreview & { import_id: number | null; written: number };

/** An earlier import, as it stands now (buckets later recorded by the dashboard no longer count). */
export type ImportRecord = {
  id: number;
  label: string;
  files: number;
  created_at: number;
  buckets: number;
  first_ts: number | null;
  last_ts: number | null;
  days: number;
};

/** Columns chosen by hand: field -> headers ([] = don't import). */
export type ColumnChoices = Record<string, string[]>;
