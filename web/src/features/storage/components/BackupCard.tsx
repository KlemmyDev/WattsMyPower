import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { ProgressBar, Spinner } from "~/features/common/ui/components/Progress";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";
import { downloadBackup } from "~/features/storage/api";
import type { BackupProgress, StorageReport } from "~/features/storage/types";
import { bytes } from "~/features/storage/utils";

type What = "dashboard" | "everything";

/** Manage → Data: download a backup of the databases, to keep before trying a new version or to take your data away. */
export function BackupCard({ report }: { report: StorageReport }) {
  const size = (id: "dashboard" | "collector") => {
    const d = report.databases.find((db) => db.id === id);
    return d?.available ? d.total_bytes : null;
  };
  const collector = size("collector");
  const [what, setWhat] = useState<What>(collector != null ? "everything" : "dashboard");
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const backup = useMutation({
    mutationFn: () => downloadBackup(what === "everything", setProgress),
    onSettled: () => setProgress(null),
  });
  const busy = backup.isPending;
  const options = [
    { value: "dashboard" as const, label: "Dashboard only" },
    { value: "everything" as const, label: "Everything" },
  ];
  const help =
    what === "everything"
      ? collector != null
        ? `The dashboard's database and the collector's raw inverter readings (${bytes(collector)}). Bigger, so it takes longer.`
        : "The dashboard's database and the collector's, but the collector's isn't available right now, so only the dashboard's would be in it."
      : `Your settings, connected services, readings history and bills (${bytes(size("dashboard"))}). Enough to pick up where you left off.`;

  return (
    <SettingsCard aria-labelledby="h-backup">
      <div className="flex flex-col gap-1 p-6 max-sm:p-5">
        <SettingsTitle
          id="h-backup"
          title="Download a backup"
          sub="A copy of your data to keep, before you try a new version or if you're moving on. Putting it back is done by hand: the README inside the zip says how."
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line-subtle px-6 py-5 max-sm:px-5">
        <div className="flex max-w-[560px] min-w-[220px] flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-semibold text-ink">What to include</span>
          <span className="text-[13px] leading-5 text-pretty text-ink-muted">{help}</span>
        </div>
        <Segmented label="What to include" options={options} value={what} onChange={(v) => !busy && setWhat(v)} />
      </div>
      <div className="flex flex-col gap-4 border-t border-line-subtle p-6 max-sm:p-5">
        <Notice tone="warn" className="flex items-start gap-3">
          <Icon name="lock" size={18} className="mt-px" />
          <span>
            <strong className="font-semibold">Keep it private.</strong> It holds the passwords and keys saved here: Tapo
            and EcoFlow passwords, Amber, Tessie and Home Assistant tokens, and the Tesla key. Anyone with the file can
            use them.
          </span>
        </Notice>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <Button onClick={() => backup.mutate()} disabled={busy}>
            {busy ? <Spinner className="text-current" /> : <Icon name="download" size={18} />}
            {busy ? "Preparing…" : "Download a backup"}
          </Button>
          {progress && <Status progress={progress} />}
        </div>
        {backup.isError && <Notice>{errorMessage(backup.error, "The backup couldn't be made. Try again.")}</Notice>}
        {backup.isSuccess && !busy && (
          <Notice tone={backup.data.skipped ? "warn" : "info"}>
            Saved {backup.data.name} ({bytes(backup.data.bytes)}).
            {backup.data.skipped && <> The collector's database isn't in it. {backup.data.skipped}</>}
          </Notice>
        )}
      </div>
    </SettingsCard>
  );
}

/** How far along the backup is, beside the button: a sweep while the server makes it, then the share downloaded. */
function Status({ progress }: { progress: BackupProgress }) {
  const making = progress.stage === "making";
  const value = !making && progress.total ? progress.received / progress.total : undefined;
  return (
    <div className="flex min-w-[200px] flex-1 flex-col gap-1.5" aria-live="polite">
      <span className="text-[13px] text-ink-muted tabular-nums">
        {making
          ? "Making the backup on the server. A large one takes a minute or two."
          : `Downloading ${bytes(progress.received)}${progress.total ? ` of ${bytes(progress.total)}` : ""}`}
      </span>
      <ProgressBar value={value} label="Backup" className="max-w-[360px]" />
    </div>
  );
}
