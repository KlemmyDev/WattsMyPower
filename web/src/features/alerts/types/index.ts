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

export type RuleCategory = "system" | "solar" | "grid" | "prices" | "summary";

export type AlertCategory = { id: RuleCategory; name: string; description: string };

export type AlertRule = {
  id: string;
  name: string;
  description: string;
  category: RuleCategory;
  /** A follow-up is sent when it clears. False for good news (strong solar, a full battery). */
  resolves: boolean;
  /** What it needs and this setup lacks, e.g. "amber" for a price alert without an Amber tariff. */
  needs: "amber" | null;
  enabled: boolean;
  /** After an alert, the least time before this rule sends another. Null for one sent on a schedule. */
  cooldown_hours: number | null;
  settings: RuleSetting[];
  /** An alert from this rule is out and not resolved yet. */
  active_since: number | null;
};

export type AlertEvent = {
  id: number;
  ts: number;
  rule: string;
  rule_name: string;
  /** `notice`: good news, such as strong solar. */
  kind: "alert" | "resolved" | "notice" | "summary";
  title: string;
  message: string;
  /** Whether it reached every channel, some, or none (`error` says why). */
  status: "sent" | "partial" | "failed";
  error: string | null;
  /** For an alert: when the problem cleared. */
  resolved_at: number | null;
};

/** A browser that turned on notifications. Its push address and keys stay on the server. */
export type PushDevice = {
  id: string;
  name: string;
  /** The push service it's reached through, e.g. fcm.googleapis.com. */
  service: string;
  created_at: number;
  last_sent: number | null;
  last_error: string | null;
};

export type PushOverview = {
  /** The server's VAPID public key (base64url), to subscribe with. */
  public_key: string;
  devices: PushDevice[];
};

export type AlertsOverview = {
  /** At least one channel is on, or a browser subscribed: alerts are being checked. */
  enabled: boolean;
  push: PushOverview;
  channels: AlertChannel[];
  categories: AlertCategory[];
  rules: AlertRule[];
  history: AlertEvent[];
};

export type RuleChange = { enabled?: boolean; settings?: Record<string, number> };
