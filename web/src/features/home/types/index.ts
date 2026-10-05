/** A device kind's key, e.g. "washer", "dryer", "fridge", "plug". */
export type DeviceKind = string;

export type HomeField = {
  key: string;
  label: string;
  type: "text" | "email" | "password" | "url";
  help: string;
  secret: boolean;
  placeholder: string;
  /** Can be left empty. */
  optional: boolean;
};

export type HomeAccount = {
  id: number;
  /** What the account is, e.g. its email. Never a secret. */
  label: string;
  connected_at: number;
  last_poll: number | null;
  error: string | null;
  /** Its sign-in no longer works: it needs signing in again, and isn't polled until then. */
  signed_out: boolean;
  devices: number;
};

/** An integration that can be connected (a smart-appliance cloud, smart plugs…), with its account if it is. */
export type HomeIntegration = {
  id: string;
  name: string;
  via: string;
  about: string;
  icon: string;
  kinds: DeviceKind[];
  fields: HomeField[];
  poll_seconds: number;
  /** Only offered in mock mode. */
  demo: boolean;
  account: HomeAccount | null;
};

/** What a device is doing, as last read. */
export type DeviceNow = {
  at: number;
  online: boolean;
  /** Not read for a few polls: what it was doing, not what it's doing. */
  stale?: boolean;
  power_w: number | null;
  running: boolean;
  program: string | null;
  phase: string | null;
  remaining_min: number | null;
  run: { start: number; kwh: number } | null;
  details: Record<string, string>;
};

export type HomeRun = {
  id: number;
  device: number;
  start: number;
  end: number | null;
  kwh: number;
  program: string | null;
  peak_w: number | null;
};

export type HomeDevice = {
  id: number;
  account: number;
  integration: string | null;
  name: string;
  kind: DeviceKind;
  model: string | null;
  hidden: boolean;
  now: DeviceNow | null;
  last_run: HomeRun | null;
};

export type HomeOverview = {
  integrations: HomeIntegration[];
  kinds: { id: DeviceKind; label: string; cycles: boolean }[];
  devices: HomeDevice[];
};

/** The home's use by the hour or day, each visible device's share, and what no device measured (kWh). */
export type HomeUsage = {
  start: number;
  end: number;
  bucket: "hour" | "day";
  t: number[];
  home: (number | null)[];
  other: (number | null)[];
  devices: {
    id: number;
    name: string;
    kind: DeviceKind;
    kwh: number[];
    total: number;
    runs: number;
    run_kwh: number | null;
    run_minutes: number | null;
  }[];
  total: { home: number | null; measured: number; other: number | null };
};

/** A device's habits over the last eight weeks. */
export type DevicePattern = {
  id: number;
  /** Days it's been read on (up to 56). */
  days: number;
  daily_kwh: number | null;
  /** Average kWh on each weekday, Monday first. */
  by_weekday: (number | null)[];
  /** Average kWh in each hour of the day. */
  by_hour: (number | null)[];
  weekdays_seen: number[];
  runs: number;
  /** Runs started on each weekday, Monday first, and in each hour. */
  run_days: number[];
  run_hours: number[];
  run_kwh: number | null;
  run_minutes: number | null;
};

export type DeviceRaw = { id: number; name: string; ts: number | null; properties: Record<string, unknown> };
