/** What Settings → Notifications reads (GET /api/notifications). Times are unix seconds. */

export type Channel = "push" | "ntfy" | "webhook";

export type RuleSetting = { key: string; label: string; unit: string; min: number; max: number; step: number };

export type Rule = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  /** Shown until dismissed, and let through quiet hours and the day's limit. */
  urgent: boolean;
  /** Which channels it uses; null: all of them. */
  channels: Channel[] | null;
  settings: RuleSetting[];
  values: Record<string, number>;
  /** While it's happening and was told to you: since when. */
  active_since: number | null;
};

export type ChannelKind = "ntfy" | "webhook";

export type ChannelState = { enabled: boolean; config: Record<string, string> };

export type ChannelField = { key: string; label: string; required: boolean };

export type PushDevice = {
  id: string;
  name: string;
  service: string;
  created_at: number;
  last_sent: number | null;
  last_error: string | null;
};

export type Options = {
  quiet: { enabled: boolean; start: string; end: string };
  daily_cap: number;
};

/** One thing sent (or held back), and how each channel took it: "ok", or why not. */
export type HistoryEntry = {
  id: number;
  ts: number;
  rule: string | null;
  event: "alert" | "resolved" | "held" | "test";
  title: string;
  body: string;
  results: Record<string, string>;
};

export type Notifications = {
  rules: Rule[];
  channels: Record<ChannelKind, ChannelState>;
  fields: Record<ChannelKind, ChannelField[]>;
  options: Options;
  push: { public_key: string; devices: PushDevice[] };
  history: HistoryEntry[];
};
