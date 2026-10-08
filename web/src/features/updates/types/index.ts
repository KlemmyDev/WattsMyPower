/** The latest version on GitHub, as last checked (app.features.updates). */
export type LatestVersion = {
  version: string;
  release: string | null;
  commit: string;
  /** When it was committed (ISO 8601). */
  date: string;
  /** Commits on GitHub since this one; null when they can't be counted (a local build, or no commit to go on). */
  changes: number | null;
};

/** This version, the latest on GitHub, and whether that's an update (GET /api/updates). */
export type UpdateStatus = {
  /** Checking every few hours is on (Settings → System → Updates). */
  enabled: boolean;
  current: { version: string; release: string | null; commit: string | null };
  latest: LatestVersion | null;
  available: boolean;
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
