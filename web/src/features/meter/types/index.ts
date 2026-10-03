/** Smart-meter (NEM12) data (/api/meter). Dates are YYYY-MM-DD, times unix seconds, energy kWh. */

export type MeterChannel = {
  nmi: string;
  /** The meter's channel, e.g. E1 (import) or B1 (export). */
  suffix: string;
  direction: "import" | "export";
  /**
   * Counted as grid import or export: each meter's lowest-numbered E and B channel (E1, B1). Others, such as
   * E2 controlled load, are stored but left out of bills, costs and the comparison.
   */
  included: boolean;
  unit: string;
  minutes: number;
  days: number;
  readings: number;
  kwh: number;
  /** Readings that are estimated or substituted rather than actual. */
  estimated: number;
  /** Intervals with no reading. */
  missing: number;
};

/** What a file holds, before (preview) or after importing it. */
export type MeterFileSummary = {
  filename: string;
  nmis: string[];
  channels: MeterChannel[];
  /** NEM days (AEST) the file covers. */
  first: string;
  last: string;
  days: number;
  import_kwh: number;
  export_kwh: number;
  estimated: number;
  missing: number;
  /** Anything worth knowing about the file, as sentences. */
  notes: string[];
};

export type MeterPreview = MeterFileSummary & { replaces_days: number };

export type MeterImport = {
  id: number;
  filename: string;
  imported_at: number;
  nmis: string[];
  intervals: number;
  start: number;
  end: number;
  /** Grid import and export: the included channels only. */
  import_kwh: number;
  export_kwh: number;
  estimated: number;
  channels: Pick<MeterChannel, "nmi" | "suffix" | "direction" | "kwh" | "included">[];
};

export type ReconcileDay = {
  date: string;
  /** The meter's readings cover the whole day, so bills use them. */
  complete: boolean;
  estimated: number;
  meter_import: number;
  meter_export: number;
  /** null without inverter readings that day. */
  dashboard_import: number | null;
  dashboard_export: number | null;
  /** Dashboard minus meter. */
  import_diff: number | null;
  export_diff: number | null;
  notable: boolean;
};

export type Reconciliation = {
  summary: {
    first: string | null;
    last: string | null;
    meter_days: number;
    complete_days: number;
    /** Days the meter covers in full and the dashboard has figures for: the totals cover these. */
    compared_days: number;
    notable_days: number;
    meter_import: number;
    dashboard_import: number;
    meter_export: number;
    dashboard_export: number;
  } | null;
  days: ReconcileDay[];
};
