import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { plural } from "~/features/common/formatting/utils/number";
import { useSaveSettings } from "~/features/common/settings/hooks";
import { saveSettingsError } from "~/features/common/settings/utils";
import { nowS, sameDay } from "~/features/common/time/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Notice } from "~/features/common/ui/components/Notice";
import { Pill } from "~/features/common/ui/components/Pill";
import { Spinner } from "~/features/common/ui/components/Progress";
import { Switch } from "~/features/common/ui/components/Switch";
import { useToast } from "~/features/common/ui/components/Toast";
import { SettingsCard } from "~/features/settings/components/SettingsCard";
import { checkForUpdates, installUpdate, updatesQuery } from "~/features/updates/api";
import type { UpdateStatus } from "~/features/updates/types";

const short = (commit: string) => commit.slice(0, 7);
const titled = (release: string | null) => (release ? release.charAt(0).toUpperCase() + release.slice(1) : null);
const UNDER_WAY = new Set(["requested", "running"]);

/** "10:42" today, else "Mon 6 Oct, 10:42". */
const when = (ts: number) => (sameDay(ts, nowS()) ? hhmm(ts) : `${shortDay.format(new Date(ts * 1000))}, ${hhmm(ts)}`);

/** What's newer, in a few words: the version, or with the same version, how many changes. */
function newerWords(s: UpdateStatus) {
  const latest = s.latest!;
  if (latest.version !== s.current.version) return `v${latest.version}`;
  return latest.changes ? `the ${latest.changes} newer ${plural(latest.changes, "change")}` : "the latest";
}

/**
 * Updates (Settings → System): the version running, the latest on GitHub and whether it's newer, checking now, and
 * turning the checks every few hours off. With the updater set up on the machine it's installed on, Update now; else
 * how to update by hand.
 */
export function UpdatesCard() {
  const qc = useQueryClient();
  const toast = useToast();
  // Every few seconds while an update is under way (and while the dashboard restarts, when it can't answer).
  const status = useQuery({
    ...updatesQuery,
    retry: false,
    refetchInterval: (q) =>
      UNDER_WAY.has(q.state.data?.install?.state ?? "") || q.state.status === "error" ? 3000 : 60 * 60_000,
  });
  const save = useSaveSettings();
  const [confirming, setConfirming] = useState(false);
  const check = useMutation({
    mutationFn: checkForUpdates,
    onSuccess: (s) => {
      qc.setQueryData(updatesQuery.queryKey, s);
      toast(s.error ? s.error : s.available ? "There's a newer version." : "You're up to date.");
    },
    onError: (e) => toast(errorMessage(e)),
  });
  const install = useMutation({
    mutationFn: installUpdate,
    onSuccess: (s) => {
      qc.setQueryData(updatesQuery.queryKey, s);
      setConfirming(false);
    },
    onError: (e) => toast(errorMessage(e)),
  });
  const s = status.data;
  const on = save.isPending ? !!save.variables?.update_check : !!s?.enabled;
  const underWay = !!s && UNDER_WAY.has(s.install.state);
  // Once the new version answers, load its dashboard: the page here is the old one's.
  const [loadedWith, setLoadedWith] = useState<string | null | undefined>(undefined);
  if (loadedWith === undefined && s) setLoadedWith(s.current.commit);
  const updated = !!s?.current.commit && loadedWith != null && s.current.commit !== loadedWith;
  useEffect(() => {
    if (!updated) return;
    toast(`Updated to v${s!.current.version}.`);
    const t = setTimeout(() => window.location.reload(), 1500);
    return () => clearTimeout(t);
  }, [updated, s, toast]);

  return (
    <SettingsCard padded aria-labelledby="h-updates" id="updates" className="scroll-mt-6 gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id="h-updates">Updates</h2>
          <span className="text-sm text-pretty text-ink-muted">
            Every few hours WattsMyPower asks GitHub, where it's published, whether there's a newer version. Nothing
            about your home is sent.
          </span>
        </div>
        <Switch
          on={on}
          disabled={save.isPending || !s}
          label="Check for updates"
          onChange={(v) =>
            save.mutate(
              { update_check: v ? 1 : 0 },
              {
                onSuccess: () => {
                  qc.invalidateQueries({ queryKey: updatesQuery.queryKey });
                  toast(v ? "Checking for updates." : "Not checking for updates.");
                },
                onError: (e) => toast(saveSettingsError(e)),
              },
            )
          }
        />
      </div>

      {s && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 max-sm:grid-cols-1">
          <Version
            label="This version"
            version={s.current.version}
            release={s.current.release}
            commit={s.current.commit}
            repo={s.repo}
          />
          {s.latest ? (
            <Version
              label="Latest on GitHub"
              version={s.latest.version}
              release={s.latest.release}
              commit={s.latest.commit}
              repo={s.repo}
              aside={
                s.available ? (
                  <Pill tone="brand" size="sm">
                    {s.latest.changes ? `${s.latest.changes} ${plural(s.latest.changes, "change")} newer` : "Newer"}
                  </Pill>
                ) : (
                  <Pill tone="ok" size="sm">
                    Up to date
                  </Pill>
                )
              }
            />
          ) : (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-ink-muted">Latest on GitHub</span>
              <span className="text-[15px] text-ink-muted">{s.checked_at ? "Couldn't check" : "Not checked yet"}</span>
            </div>
          )}
        </div>
      )}

      {s?.error && !underWay && <Notice tone="warn">{s.error}</Notice>}

      {/* An update under way, or the dashboard restarting at its end (when it can't answer for a minute). */}
      {(underWay || (status.isError && s && UNDER_WAY.has(s.install.state)) || updated) && s && (
        <Progress s={s} restarting={status.isError || updated} />
      )}
      {!underWay && s?.install.state === "failed" && (
        <Notice className="flex flex-col gap-2">
          <span>The update didn't finish. {s.install.error}</span>
          <Log lines={s.install.log} />
        </Notice>
      )}
      {!underWay && s?.install.state === "expired" && (
        <Notice tone="warn">
          The update was asked for while the updater wasn't running, so it was dropped. Try again.
        </Notice>
      )}

      {s?.available && !underWay && !updated && (
        <>
          {s.install.ready ? (
            confirming && (
              <div className="flex flex-col gap-3 rounded-2xl border border-line-subtle bg-surface-inset p-4 text-sm">
                <span className="font-medium">Update to {newerWords(s)} now?</span>
                <span className="text-pretty text-ink-muted">
                  It downloads the update, backs up your data and rebuilds, which takes a few minutes. The dashboard is
                  away for a minute while it restarts, and then this page reloads. Your inverters keep being recorded.
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => install.mutate()} disabled={install.isPending}>
                    {install.isPending ? "Asking…" : "Update now"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )
          ) : (
            <HowToUpdate s={s} />
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {s?.available && s.install.ready && !underWay && !confirming && !updated && (
          <Button size="sm" onClick={() => setConfirming(true)}>
            Update now
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => check.mutate()} disabled={check.isPending || underWay}>
          {check.isPending ? "Checking…" : "Check now"}
        </Button>
        {s?.latest && (
          <a
            href={
              s.available && s.current.commit && s.latest.changes != null
                ? `https://github.com/${s.repo}/compare/${s.current.commit}...${s.latest.commit}`
                : `https://github.com/${s.repo}/commits/${s.branch}`
            }
            target="_blank"
            rel="noreferrer"
            className="text-[13px] text-link no-underline hover:text-link-hover"
          >
            See what's changed
          </a>
        )}
        <span className="ml-auto text-[13px] text-ink-faint">
          {s?.checked_at ? `Checked ${when(s.checked_at)}` : s?.enabled === false ? "Checking is off" : ""}
        </span>
      </div>
    </SettingsCard>
  );
}

/** An update under way: waiting for the updater, install.sh's progress, then the dashboard restarting. */
function Progress({ s, restarting }: { s: UpdateStatus; restarting: boolean }) {
  const title = restarting
    ? "Restarting with the new version…"
    : s.install.state === "requested"
      ? "Starting the update…"
      : "Updating…";
  const sub = restarting
    ? "The dashboard is away for a moment. This page reloads once it's back."
    : s.install.state === "requested"
      ? "The updater on this machine picks it up within a minute."
      : "Downloading, backing up your data and rebuilding. This takes a few minutes; the dashboard restarts at the end.";
  return (
    <div role="status" className="flex flex-col gap-3 rounded-2xl border border-brand/25 bg-brand-subtle p-4 text-sm">
      <div className="flex items-start gap-3">
        <Spinner size={18} className="mt-0.5" />
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-ink">{title}</span>
          <span className="text-pretty text-ink-muted">{sub}</span>
        </div>
      </div>
      {!restarting && s.install.log.length > 0 && <Log lines={s.install.log.slice(-6)} />}
    </div>
  );
}

/** The end of install.sh's output. */
function Log({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <pre className="m-0 max-h-40 overflow-auto rounded-lg bg-canvas px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap text-ink-muted">
      {lines.join("\n")}
    </pre>
  );
}

function Version({
  label,
  version,
  release,
  commit,
  repo,
  aside,
}: {
  label: string;
  version: string;
  release: string | null;
  commit: string | null;
  repo: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="flex flex-wrap items-center gap-2 text-[15px] font-medium tabular-nums">
        v{version}
        {release && <span className="text-ink-muted">· {titled(release)}</span>}
        {aside}
      </span>
      {commit && (
        <a
          href={`https://github.com/${repo}/commit/${commit}`}
          target="_blank"
          rel="noreferrer"
          className="w-fit font-mono text-xs text-ink-faint no-underline hover:text-link"
        >
          {short(commit)}
        </a>
      )}
    </div>
  );
}

/** How to update by hand, while updating from here isn't set up (or can't run), and why not. */
function HowToUpdate({ s }: { s: UpdateStatus }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line-subtle bg-surface-inset p-4 text-sm">
      <span className="font-medium">To update to {newerWords(s)}</span>
      <span className="text-pretty text-ink-muted">
        On the machine WattsMyPower runs on, run this in its folder. It downloads the update, backs up your data and
        rebuilds; your settings and history are kept.
      </span>
      <code className="w-fit rounded-lg bg-canvas px-3 py-1.5 font-mono text-[13px] text-ink select-all">
        bash install.sh
      </code>
      {s.install.why && <span className="text-[13px] text-pretty text-ink-faint">{s.install.why}</span>}
    </div>
  );
}
