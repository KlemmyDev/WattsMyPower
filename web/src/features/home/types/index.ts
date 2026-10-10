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
  /** The button to look for devices added since it was connected ("Look for new plugs"), if it has one. */
  find_label: string | null;
  can_switch: boolean;
  /** Read through its maker's cloud, not on the home network. */
  cloud: boolean;
  account: HomeAccount | null;
};

/** A device that holds charge (a portable battery in a room): how full it is and where its power is going. What it
 * draws from the house is its power_w. */
export type DeviceBattery = {
  /** % charged. */
  soc: number | null;
  /** What it holds full (null: not known). */
  capacity_kwh: number | null;
  /** Coming in from its own panels, not the house (W). */
  solar_w: number | null;
  /** What it's powering, from its outlets (W). */
  output_w: number | null;
};

/** What a device is doing, as last read. */
export type DeviceNow = {
  at: number;
  online: boolean;
  /** Not read for a few polls: what it was doing, not what it's doing. */
  stale?: boolean;
  /** What it's drawing (W). For an appliance that doesn't report it, while it runs with its estimate on: what its runs
   * usually draw (`estimated`). */
  power_w: number | null;
  /** power_w is what its runs usually draw, not a reading. */
  estimated?: boolean;
  /** With an estimated power_w: what the run has likely used so far, and by its end (null: it doesn't say how long is
   * left), kWh. */
  estimate?: { kwh_so_far: number; kwh_total: number | null };
  running: boolean;
  program: string | null;
  phase: string | null;
  remaining_min: number | null;
  run: { start: number; kwh: number } | null;
  details: Record<string, string>;
  /** About the device itself (its Wi-Fi signal, firmware…), for its own page. */
  info?: Record<string, string>;
  /** For a device that can be switched: whether it's on (null: it doesn't say). A portable battery's switch is its
   * AC outlets. */
  switched_on: boolean | null;
  /** For a device that holds charge. */
  battery?: DeviceBattery | null;
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
  /** The group it's shown in on the Home page, with the others in it as one ("Study"); null: on its own. */
  group: string | null;
  now: DeviceNow | null;
  last_run: HomeRun | null;
  /** It can be switched on and off from here. */
  can_switch: boolean;
  /** Its rule for running on spare solar, if it has one. */
  rule: HomeRule | null;
  /** For an appliance that doesn't report its power (a Hisense washer): showing what its runs usually draw while it
   * runs. Null for one that reports it. */
  estimate: DeviceEstimate | null;
};

export type DeviceEstimate = {
  on: boolean;
  /** What its runs usually draw (W): null until `needs` runs have finished with their energy. */
  w: number | null;
  /** How many runs it's from. */
  runs: number;
  needs: number;
};

/** Running a device on spare solar: on once the home sends start_w to the grid, off once it draws stop_w from it. */
export type HomeRule = {
  enabled: boolean;
  start_w: number;
  stop_w: number;
  /** Only between these times (HH:MM), or any time (null). */
  from: string | null;
  until: string | null;
  /** Off while power costs more than this ($/kWh), or no limit (null). */
  max_price: number | null;
  /** Switched by hand: the rule waits until then. */
  paused_until: number | null;
  /** What it last did. */
  last: { at: number; on: boolean; why: string } | null;
};

export type HomeRuleSettings = Pick<HomeRule, "enabled" | "start_w" | "stop_w" | "from" | "until" | "max_price">;

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
    /** What it cost ($): its share of what came from the grid, at the rate of the time. */
    cost: number;
    /** The share of its energy that came from the panels or the battery (null: it used nothing). */
    solar_share: number | null;
  }[];
  /** What the car drew from the home's power (as a Tesla measured it, else found in what no device measured), with
   * what it cost; null without a car connected. */
  car: { kwh: number[]; total: number; cost: number; solar_share: number | null } | null;
  total: {
    home: number | null;
    /** What the devices and the car measured, together. */
    measured: number;
    other: number | null;
    /** What the period cost, as Bills prices it ($): the import, split between the devices, the car and everything else, the
     * daily supply charges, and the feed-in credit. */
    cost: { import: number; supply: number; credit: number; devices: number; car: number; other: number };
  };
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

/** What the home draws all the time, at night: the home's and each device's (W), and what it comes to a year ($). */
export type Standby = {
  nights: number;
  home_w: number | null;
  yearly_cost: number | null;
  devices: { id: number; w: number; yearly_cost: number }[];
  measured_w: number;
  rate: number;
};

/** A habit in what no device measures: a block of use that comes back at about the same time on several days. */
export type Habit = {
  /** When it usually starts, minutes into the day. */
  at: number;
  minutes: number;
  kw: number;
  days: number;
  of_days: number;
  kwh_per_day: number;
  guess: string | null;
  guess_label: string | null;
};

/** When to start an appliance that runs in cycles, today or tomorrow. */
export type BestTime = {
  id: number;
  start: number;
  end: number;
  /** The share of a typical run spare solar would cover. */
  solar_share: number;
  /** What the rest would cost from the grid ($). */
  cost: number;
  /** "solar": covered by spare solar; "cheapest": the least it would cost from the grid. */
  why: "solar" | "cheapest";
  run_kwh: number;
};

/** Something that changed in the last 7 days against the 7 before. */
export type Change =
  | { type: "use"; name: string; id: number; group: boolean; now: number; before: number }
  | { type: "new"; name: string; id: number; group: boolean; now: number }
  | { type: "runs"; name: string; id: number; now: number; before: number }
  | { type: "car"; now: number; before: number }
  | { type: "standby"; now: number; before: number }
  | { type: "quiet"; name: string; id: number; since: number };

/** What an appliance's runs cost, and would have at each day's best time. */
export type Saving = {
  id: number;
  runs: number;
  cost: number;
  best_cost: number;
  saved: number;
  usual_hour: number;
  best_hour: number;
  days: number;
};

export type HomeInsights = {
  standby: Standby;
  unexplained: { days: number; habits: Habit[] };
  best_times: BestTime[];
  changes: { since: number; items: Change[] };
  savings: Saving[];
};

/** A run with what the appliance drew through it (W per 5 minutes). */
export type RunCurve = { run: HomeRun; t: number[]; w: number[] };

/** A peak: the most a device was read drawing in a 5 minutes, against its usual daily highest. */
export type HomePeak = { ts: number; device: number; w: number; usual_w: number | null; spike: boolean };

/** A day ahead: what's usually used on that weekday, and the range 8 in 10 of them came within (null: nothing yet). */
export type HomeDayAhead = { date: string; kwh: number | null; low: number | null; high: number | null };

/** Some devices' use together (a room's, or one device's), looked at closely. */
export type HomeProfile = {
  /** Past days it's judged by (up to eight weeks). */
  days: number;
  today: {
    /** 5-minute buckets so far today, and the average W in each. */
    t: number[];
    w: number[];
    kwh: number;
    usual: {
      /** The usual day is this weekday's (otherwise every day's, with too few of them). */
      same_weekday: boolean;
      days: number;
      /** W through each slot of the day (seconds long), from midnight. */
      slot: number;
      w: number[];
      /** kWh usually used by now, and in the whole day. */
      by_now: number;
      kwh: number;
    };
    /** Where today's likely to end up (null: nothing to go on). */
    by_midnight: number | null;
  };
  /** Average kWh in each hour (24) of each weekday (7, Monday first); null for a weekday not seen yet. */
  week: (number | null)[][];
  ahead: HomeDayAhead[];
  month: { used: number; likely: number | null; days_left: number };
  /** Each device's usual peak (the median of its days' highest, on days it did something) and its highest, over the
   * last 30 days; the highest usual first. */
  peaks: { device: number; usual_w: number; days: number; max: HomePeak }[];
  /** Days a device drew well over its usual peak, newest first. */
  spikes: HomePeak[];
  peak_today: HomePeak | null;
};
