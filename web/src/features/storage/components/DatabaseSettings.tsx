import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "~/features/common/api/utils";
import { Notice } from "~/features/common/ui/components/Notice";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { measureAgain, storageQuery } from "~/features/storage/api";
import { DatabaseCard } from "~/features/storage/components/DatabaseCard";
import { StorageOverview } from "~/features/storage/components/StorageOverview";

/** Manage → Data: everything stored, in both databases, and how much room each part takes. */
export function DatabaseSettings() {
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
      <StorageOverview report={report.data} measuring={measure.isPending} onMeasure={() => measure.mutate()} />
      {measure.isError && (
        <Notice>{errorMessage(measure.error, "The databases couldn't be measured. Try again.")}</Notice>
      )}
      {report.data.databases.map((db) => (
        <DatabaseCard key={db.id} db={db} />
      ))}
    </>
  );
}
