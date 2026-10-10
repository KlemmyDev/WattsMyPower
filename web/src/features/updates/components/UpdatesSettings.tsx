import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { plural } from "~/features/common/formatting/utils/number";
import { useSaveSettings } from "~/features/common/settings/hooks";
import { saveSettingsError } from "~/features/common/settings/utils";
import { nowS, sameDay } from "~/features/common/time/utils";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Button, buttonClass } from "~/features/common/ui/components/Button";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { Notice } from "~/features/common/ui/components/Notice";
import { Spinner } from "~/features/common/ui/components/Progress";
import { Switch } from "~/features/common/ui/components/Switch";
import { useToast } from "~/features/common/ui/components/Toast";
import {
  ChoiceTiles,
  OptionList,
  OptionRow,
  SettingsSection,
  SettingsSplit,
} from "~/features/settings/components/SettingsSection";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";
import { checkForUpdates, installUpdate, setChannel, updatesQuery } from "~/features/updates/api";
import { CHANNEL } from "~/features/updates/utils";
import type { Channel, UpdateStatus } from "~/features/updates/types";

const short = (commit: string) => commit.slice(0, 7);
const UNDER_WAY = new Set(["requested", "running"]);

const ABOUT: Record<Channel, string> = {
  nightly: "Every change as soon as it's merged. The newest, and the least tried.",
  beta: "Pre-releases to try before they're stable, and every stable release.",
  stable: "Releases only, once they've been tried. Updates less often.",
};
const CHANNEL_ICON: Record<Channel, IconName> = { nightly: "moon", beta: "flask", stable: "shield" };
const CHANNEL_TILES = (Object.keys(CHANNEL) as Channel[]).map((value) => ({
  value,
  title: CHANNEL[value].label,
  sub: ABOUT[value],
  icon: CHANNEL_ICON[value],
  color: CHANNEL[value].color,
}));
const channelName = (c: Channel) => CHANNEL[c].label;

/** "10:42" today, else "Mon 6 Oct, 10:42". */
const when = (ts: number) => (sameDay(ts, nowS()) ? hhmm(ts) : `${shortDay.format(new Date(ts * 1000))}, ${hhmm(ts)}`);

/** What's newer, in a few words: the version, or with the same version, how many changes. */
function newerWords(s: UpdateStatus) {
  const latest = s.latest!;
  if (latest.version !== s.current.version) return `v${latest.version}`;
  return latest.changes ? `the ${latest.changes} newer ${plural(latest.changes, "change")}` : "the latest";
}

/** The changes this version has that the channel's older one hasn't, in a few words. */
const leftOut = (s: UpdateStatus) =>
  s.latest?.behind ? `the ${s.latest.behind} ${plural(s.latest.behind, "change")} since` : "what's newer here";

/** Where "See what's changed" goes: between the two, a release's notes, or main's history. */
function changesUrl(s: UpdateStatus) {
  const { repo, current, latest } = s;
  if (latest && current.commit && latest.changes != null && s.move === "update")
    return `https://github.com/${repo}/compare/${current.commit}...${latest.commit}`;
  if (latest && current.commit && latest.behind != null && s.move === "older")
    return `https://github.com/${repo}/compare/${latest.commit}...${current.commit}`;
  if (latest?.tag) return `https://github.com/${repo}/releases/tag/${latest.tag}`;
  return `https://github.com/${repo}/commits/${s.branch}`;
}

/** Settings → Updates. */
export function UpdatesSettings() {
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/settings">Settings</BackLink>}
        id="h-updates-page"
        title="Updates"
        sub="The version you're running, the release channel it follows, and installing newer ones."
      />
      <UpdatesBody />
    </>
  );
}

/**
 * Updates (Settings → Updates): the version running and the channel's on GitHub at the top, then whether it's
 * newer (or older, after moving to a channel behind this version) and checking now, the release channel followed, and
 * turning the checks every few hours off. With the updater set up on the machine it's installed on, Update now (or going back); else how to update
 * by hand.
 */
function UpdatesBody() {
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
  const channel = useMutation({
    mutationFn: setChannel,
    onSuccess: (s) => {
      qc.setQueryData(updatesQuery.queryKey, s);
      setConfirming(false);
      toast(`Following ${channelName(s.channel)}.`);
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
  const following = channel.isPending ? channel.variables : s?.channel;
  const older = s?.move === "older";
  // Once the new version answers, load its dashboard: the page here is the old one's.
  const [loadedWith, setLoadedWith] = useState<string | null | undefined>(undefined);
  if (loadedWith === undefined && s) setLoadedWith(s.current.commit);
  const updated = !!s?.current.commit && loadedWith != null && s.current.commit !== loadedWith;
  useEffect(() => {
    if (!updated) return;
    toast(`Now on v${s!.current.version}.`);
    const t = setTimeout(() => window.location.reload(), 1500);
    return () => clearTimeout(t);
  }, [updated, s, toast]);

  const color = CHANNEL[following ?? "nightly"].color;
  const headline = !s
    ? "Checking…"
    : underWay || updated
      ? "Updating"
      : s.available
        ? `${newerWords(s)
            .replace(/^the /, "")
            .replace(/^./, (c) => c.toUpperCase())} available`
        : older
          ? `v${s.latest!.version} on ${channelName(s.channel)} is older`
          : s.latest
            ? "You're up to date"
            : s.unreleased
              ? "Nothing released yet"
              : "Not checked yet";

  return (
    <SettingsSplit
      visual={
        <SettingsSection
          id="h-update"
          title={headline}
          sub={[
            s?.available ? "A newer version is on your channel." : "WattsMyPower is published on GitHub.",
            s?.checked_at ? `Checked ${when(s.checked_at)}.` : s?.enabled === false ? "Checking is off." : null,
          ]
            .filter(Boolean)
            .join(" ")}
          aside={
            <div className="flex flex-wrap items-center gap-2">
              {s?.latest && (
                <a href={changesUrl(s)} target="_blank" rel="noreferrer" className={buttonClass("muted-link", "sm")}>
                  See what's changed
                </a>
              )}
              <Button variant="outline" size="sm" onClick={() => check.mutate()} disabled={check.isPending || underWay}>
                {check.isPending ? "Checking…" : "Check now"}
              </Button>
            </div>
          }
        >
          {s && <VersionTrack s={s} color={color} />}
          {s?.error && !underWay && <Notice tone="warn">{s.error}</Notice>}
          {s?.unreleased && !channel.isPending && (
            <Notice tone="info">
              Nothing has been released on {channelName(s.channel)} yet, so this version stays until there is. Nightly
              has every change as it's merged.
            </Notice>
          )}

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

          {s?.move && !underWay && !updated && (
            <>
              {s.install.ready ? (
                confirming ? (
                  <div className="flex animate-pop flex-col gap-3 rounded-2xl bg-canvas/60 p-5 text-sm light:bg-canvas">
                    <span className="font-semibold">
                      {older
                        ? `Go back to v${s.latest!.version} on ${channelName(s.channel)}?`
                        : `Update to ${newerWords(s)} now?`}
                    </span>
                    {older && (
                      <span className="text-pretty text-ink-muted">
                        It's older than this version, so {leftOut(s)} won't be in it. Anything they recorded stays in
                        the database, for when it's updated again.
                      </span>
                    )}
                    <span className="text-pretty text-ink-muted">
                      It downloads it, backs up your data and rebuilds, which takes a few minutes. The dashboard is away
                      for a minute while it restarts, and then this page reloads. Your inverters keep being recorded.
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => install.mutate()} disabled={install.isPending}>
                        {install.isPending ? "Asking…" : older ? "Go back" : "Update now"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <Button size="sm" variant={older ? "outline" : undefined} onClick={() => setConfirming(true)}>
                      {older ? `Go back to v${s.latest!.version}` : "Update now"}
                    </Button>
                  </div>
                )
              ) : (
                <HowToUpdate s={s} />
              )}
            </>
          )}
        </SettingsSection>
      }
    >
      {s && following && (
        <SettingsSection
          id="h-channel"
          title="Release channel"
          sub="Which releases this dashboard follows. Choosing one behind this version offers to go back to it."
        >
          <ChoiceTiles
            label="Release channel"
            rows
            value={following}
            onChange={(c) => channel.mutate(c)}
            disabled={channel.isPending}
            options={CHANNEL_TILES}
          />
        </SettingsSection>
      )}

      <SettingsSection id="h-updates" title="Automatic checks">
        <OptionList>
          <OptionRow
            label="Check for updates"
            help="Every few hours WattsMyPower asks GitHub whether there's a newer version on your channel."
            icon="clock"
            color={COLOR.brand}
          >
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
          </OptionRow>
        </OptionList>
      </SettingsSection>
    </SettingsSplit>
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

/**
 * How to update by hand, while updating from here isn't set up (or can't run), and why not. On Windows, install.ps1
 * again (it runs install.sh in WattsMyPower's WSL distribution), or install.sh in there.
 */
function HowToUpdate({ s }: { s: UpdateStatus }) {
  const what = `It installs ${channelName(s.channel)}'s version, backs up your data and rebuilds; your settings and history are kept.`;
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-canvas/60 p-5 text-sm light:bg-canvas">
      <span className="font-medium">
        {s.move === "older" ? `To go back to v${s.latest!.version}` : `To update to ${newerWords(s)}`}
      </span>
      {s.windows ? (
        <>
          <span className="text-pretty text-ink-muted">
            On the Windows PC WattsMyPower runs on, run the installer again in PowerShell. {what}
          </span>
          <Command>{`irm https://raw.githubusercontent.com/${s.repo}/${s.branch}/install.ps1 | iex`}</Command>
          <span className="text-[13px] text-pretty text-ink-muted">
            Or in its Linux distribution (<code className="font-mono">wsl -d WattsMyPower</code>, then{" "}
            <code className="font-mono">cd ~/wattsmypower</code>):
          </span>
          <Command>bash install.sh</Command>
        </>
      ) : (
        <>
          <span className="text-pretty text-ink-muted">
            On the machine WattsMyPower runs on, run this in its folder. {what}
          </span>
          <Command>bash install.sh</Command>
        </>
      )}
      {s.install.why && <span className="text-[13px] text-pretty text-ink-faint">{s.install.why}</span>}
    </div>
  );
}

/** A command to copy (selected whole with a click). */
function Command({ children }: { children: string }) {
  return (
    <code className="w-fit max-w-full rounded-lg bg-canvas px-3 py-1.5 font-mono text-[13px] break-all text-ink select-all">
      {children}
    </code>
  );
}

/**
 * This version and the channel's latest on a line, a dot for each change between them (the newest few, past 24), in
 * the channel's colour: how far behind (or ahead, after moving to a channel behind it) this dashboard is.
 */
function VersionTrack({ s, color }: { s: UpdateStatus; color: string }) {
  const latest = s.latest;
  const older = s.move === "older";
  const gap = latest ? ((older ? latest.behind : latest.changes) ?? 0) : 0;
  const shown = Math.min(gap, 24);
  const end = (label: string, version: string, commit: string | null, c: string, align: "start" | "end") => (
    <div className={cn("flex min-w-0 flex-col", align === "end" ? "items-end text-right" : "items-start")}>
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="text-[20px] leading-7 font-light tracking-[-0.3px] tabular-nums" style={{ color: c }}>
        {version}
      </span>
      {commit && (
        <a
          href={`https://github.com/${s.repo}/commit/${commit}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[11px] text-ink-faint no-underline hover:text-link"
        >
          {short(commit)}
        </a>
      )}
    </div>
  );
  const here = end("This version", s.current.version, s.current.commit, "var(--color-ink)", older ? "end" : "start");
  if (!latest || (!s.move && !gap))
    return (
      <div className="flex items-center gap-4 rounded-2xl bg-canvas/60 p-4 light:bg-canvas">
        <span
          className="flex size-10 flex-none items-center justify-center rounded-full"
          style={{ background: alpha(color, 0.18), color }}
        >
          <Icon name={latest ? "check" : "clock"} size={18} />
        </span>
        {here}
      </div>
    );
  const there = end(
    `Latest on ${channelName(s.channel)}`,
    latest.version,
    latest.commit,
    color,
    older ? "start" : "end",
  );
  const dots = Array.from({ length: shown }, (_, i) => i);
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-canvas/60 p-4 light:bg-canvas">
      <div className="flex items-start justify-between gap-4">
        {older ? there : here}
        {older ? here : there}
      </div>
      <div className="relative flex h-4 items-center">
        <div className="absolute inset-x-0 h-0.5 rounded-full" style={{ background: alpha(color, 0.3) }} />
        <span
          className="relative size-3.5 flex-none rounded-full ring-2 ring-surface"
          style={{ background: older ? color : COLOR.ink }}
        />
        <div className="relative flex flex-1 items-center justify-evenly px-1">
          {dots.map((i) => (
            <span
              key={i}
              className="size-1.5 animate-pop rounded-full"
              style={{ background: older ? COLOR.inkMuted : color, animationDelay: `${i * 25}ms` }}
            />
          ))}
        </div>
        <span
          className="relative size-3.5 flex-none rounded-full ring-2 ring-surface"
          style={{ background: older ? COLOR.ink : color }}
        />
      </div>
      <span className="text-center text-[13px] text-ink-muted">
        {older
          ? `${gap} ${plural(gap, "change")} here aren't in ${channelName(s.channel)}'s version`
          : gap
            ? `${gap} ${plural(gap, "change")} since this version${gap > shown ? ` (the newest ${shown} shown)` : ""}`
            : "A newer version"}
      </span>
    </div>
  );
}
