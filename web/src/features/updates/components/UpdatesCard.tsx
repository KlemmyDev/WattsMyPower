import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { plural } from "~/features/common/formatting/utils/number";
import { useSaveSettings } from "~/features/common/settings/hooks";
import { saveSettingsError } from "~/features/common/settings/utils";
import { sameDay, nowS } from "~/features/common/time/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Notice } from "~/features/common/ui/components/Notice";
import { Pill } from "~/features/common/ui/components/Pill";
import { Switch } from "~/features/common/ui/components/Switch";
import { useToast } from "~/features/common/ui/components/Toast";
import { SettingsCard } from "~/features/settings/components/SettingsCard";
import { checkForUpdates, updatesQuery } from "~/features/updates/api";
import type { UpdateStatus } from "~/features/updates/types";

const short = (commit: string) => commit.slice(0, 7);
const titled = (release: string | null) => (release ? release.charAt(0).toUpperCase() + release.slice(1) : null);

/** "10:42" today, else "Mon 6 Oct, 10:42". */
const when = (ts: number) => (sameDay(ts, nowS()) ? hhmm(ts) : `${shortDay.format(new Date(ts * 1000))}, ${hhmm(ts)}`);

/**
 * Updates (Settings → System): the version running, the latest on GitHub and whether it's newer, checking now, and
 * turning the checks every few hours off. Updating itself is install.sh, run where WattsMyPower is installed.
 */
export function UpdatesCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const status = useQuery(updatesQuery);
  const save = useSaveSettings();
  const check = useMutation({
    mutationFn: checkForUpdates,
    onSuccess: (s) => {
      qc.setQueryData(updatesQuery.queryKey, s);
      toast(s.error ? s.error : s.available ? "There's a newer version." : "You're up to date.");
    },
    onError: (e) => toast(errorMessage(e)),
  });
  const s = status.data;
  const on = save.isPending ? !!save.variables?.update_check : !!s?.enabled;

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

      {s?.error && <Notice tone="warn">{s.error}</Notice>}
      {s?.available && <HowToUpdate s={s} />}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => check.mutate()} disabled={check.isPending}>
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

/** How to update: install.sh, where it's installed (updating from here is yet to come). */
function HowToUpdate({ s }: { s: UpdateStatus }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line-subtle bg-surface-inset p-4 text-sm">
      <span className="font-medium">
        {s.latest!.version !== s.current.version
          ? `To update to v${s.latest!.version}`
          : s.latest!.changes
            ? `To get the ${s.latest!.changes} newer ${plural(s.latest!.changes, "change")}`
            : "To update"}
      </span>
      <span className="text-pretty text-ink-muted">
        On the machine WattsMyPower runs on, run this in its folder. It downloads the new version, backs up your data
        and rebuilds; your settings and history are kept.
      </span>
      <code className="w-fit rounded-lg bg-canvas px-3 py-1.5 font-mono text-[13px] text-ink select-all">
        bash install.sh
      </code>
    </div>
  );
}
