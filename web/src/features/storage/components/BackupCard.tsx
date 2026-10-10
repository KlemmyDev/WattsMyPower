import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { ProgressBar, Spinner } from "~/features/common/ui/components/Progress";
import { COLOR } from "~/features/common/theme/utils/colors";
import { ChoiceTiles, SettingsSection } from "~/features/settings/components/SettingsSection";
import { downloadBackup } from "~/features/storage/api";
import type { BackupProgress, StorageReport } from "~/features/storage/types";
import { bytes } from "~/features/storage/utils";

type What = "dashboard" | "everything";

/** Settings → Data: download a backup of the databases, to keep before trying a new version or to take your data away. */
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
  const dashboard = size("dashboard");
  const options = [
    {
      value: "dashboard" as const,
      title: `Dashboard only${dashboard != null ? ` · ${bytes(dashboard)}` : ""}`,
      sub: "Your settings, connected services, readings history and bills. Enough to pick up where you left off.",
      icon: "database" as const,
    },
    {
      value: "everything" as const,
      title: `Everything${collector != null && dashboard != null ? ` · ${bytes(collector + dashboard)}` : ""}`,
      sub:
        collector != null
          ? "The collector's raw inverter readings too. Bigger, so it takes longer."
          : "The collector's isn't available right now, so only the dashboard's would be in it.",
      icon: "pulse" as const,
    },
  ];

  return (
    <SettingsSection
      id="h-backup"
      title="Download a backup"
      sub="A copy of your data to keep, before you try a new version or if you're moving on. The README inside the zip says how to put it back."
    >
      <ChoiceTiles
        label="What to include"
        rows
        color={COLOR.teal}
        options={options}
        value={what}
        onChange={(v) => !busy && setWhat(v)}
      />
      <Notice tone="warn" className="flex items-start gap-3">
        <Icon name="lock" size={18} className="mt-px flex-none" />
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
    </SettingsSection>
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
