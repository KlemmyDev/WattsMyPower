import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "~/features/common/api/utils";
import { Notice } from "~/features/common/ui/components/Notice";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { measureAgain, storageQuery } from "~/features/storage/api";
import { BackupCard } from "~/features/storage/components/BackupCard";
import { DatabaseCard } from "~/features/storage/components/DatabaseCard";
import { StorageFacts, StorageVisual } from "~/features/storage/components/StorageOverview";
import { SettingsSplit } from "~/features/settings/components/SettingsSection";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

/** Settings → Data: everything stored, in both databases, how much room each part takes, and a backup to download. */
export function DatabaseSettings() {
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/settings">Settings</BackLink>}
        id="h-data-page"
        title="Data"
        sub="What's stored, how much room it takes, and a backup to download."
      />
      <Storage />
    </>
  );
}

function Storage() {
  const qc = useQueryClient();
  const report = useQuery(storageQuery);
  const measure = useMutation({
    mutationFn: measureAgain,
    onSuccess: (fresh) => qc.setQueryData(storageQuery.queryKey, fresh),
  });

  if (report.isPending)
    return (
      <>
        <Skeleton className="h-[330px] rounded-3xl" />
        <Skeleton className="h-[480px] rounded-3xl" />
      </>
    );
  if (report.isError)
    return <Notice>{errorMessage(report.error, "The databases couldn't be measured. Try again.")}</Notice>;

  return (
    <>
      {measure.isError && (
        <Notice>{errorMessage(measure.error, "The databases couldn't be measured. Try again.")}</Notice>
      )}
      <SettingsSplit
        visual={<StorageVisual report={report.data} measuring={measure.isPending} onMeasure={() => measure.mutate()} />}
      >
        <StorageFacts report={report.data} />
        <BackupCard report={report.data} />
      </SettingsSplit>
      <h2 className="px-1 pt-3 text-[13px] leading-5 font-semibold tracking-[0.08em] text-ink-muted uppercase">
        Table by table
      </h2>
      {report.data.databases.map((db) => (
        <DatabaseCard key={db.id} db={db} />
      ))}
    </>
  );
}
