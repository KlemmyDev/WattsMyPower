/** The release channels: every change merged to main, pre-releases and releases, or releases only. */
export type Channel = "nightly" | "beta" | "stable";

/** The version the channel is at on GitHub, as last checked (app.features.updates). */
export type LatestVersion = {
  version: string;
  release: string | null;
  commit: string;
  /** Its release tag (v2026.10.9, v2026.10.9-beta); null on nightly. */
  tag: string | null;
  /** When it was committed (ISO 8601), on nightly. */
  date: string | null;
  /** Commits it has that this one hasn't, and this one has that it hasn't; null when they can't be counted (a local
   * build, or no commit to go on). */
  changes: number | null;
  behind: number | null;
};

/** This version, the channel's on GitHub, and whether that's an update or older (GET /api/updates). */
export type UpdateStatus = {
  /** Checking every few hours is on (Manage → System → Updates). */
  enabled: boolean;
  channel: Channel;
  current: { version: string; release: string | null; commit: string | null };
  latest: LatestVersion | null;
  /** What installing the channel's version would be: an update, older (after moving to a channel behind this
   * version), or nothing. `available` is an update. */
  move: "update" | "older" | null;
  available: boolean;
  /** Nothing has been released on the channel yet. */
  unreleased: boolean;
  /** When it last checked (unix seconds), and why that failed, if it did. */
  checked_at: number | null;
  error: string | null;
  repo: string;
  branch: string;
  /** Updating from here, by updater.sh on the machine it's installed on. */
  install: Installer;
};

/**
 * updater.sh: whether it's there and can update (`ready`, else `why`), and how an update is going. `state`: idle;
 * requested (it starts within a minute); running; done, failed or expired (asked for while it wasn't running), for a
 * while after. `log`: the end of install.sh's output while it runs, or when it failed.
 */
export type Installer = {
  ready: boolean;
  why: string | null;
  state: "idle" | "requested" | "running" | "done" | "failed" | "expired";
  started_at: number | null;
  finished_at: number | null;
  /** The commits before and after. */
  from: string | null;
  to: string | null;
  error: string | null;
  log: string[];
};
