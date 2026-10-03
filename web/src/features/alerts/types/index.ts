/** Alerts and notifications (GET /api/alerts). Times are unix seconds. */

export type ChannelKind = "ntfy" | "pushover" | "webhook";

/** Where alerts are sent. Secrets in `config` come masked ("••••x9Qa"); sending one back unchanged keeps it. */
export type AlertChannel = {
  kind: ChannelKind;
  label: string;
  configured: boolean;
  enabled: boolean;
  config: Record<string, string>;
  updated_at: number | null;
};

/** A rule's threshold, e.g. "At or below 10 %". */
export type RuleSetting = {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  default: number;
  value: number;
};

export type AlertRule = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  /** After an alert, the least time before this rule sends another. */
  cooldown_hours: number;
  settings: RuleSetting[];
  /** An alert from this rule is out and not resolved yet. */
  active_since: number | null;
};

export type AlertEvent = {
  id: number;
  ts: number;
  rule: string;
  rule_name: string;
  kind: "alert" | "resolved" | "summary";
  title: string;
  message: string;
  /** Whether it reached every channel, some, or none (`error` says why). */
  status: "sent" | "partial" | "failed";
  error: string | null;
  /** For an alert: when the problem cleared. */
  resolved_at: number | null;
};

export type AlertsOverview = {
  /** At least one channel is on: alerts are being checked. */
  enabled: boolean;
  channels: AlertChannel[];
  rules: AlertRule[];
  history: AlertEvent[];
};

export type RuleChange = { enabled?: boolean; settings?: Record<string, number> };
