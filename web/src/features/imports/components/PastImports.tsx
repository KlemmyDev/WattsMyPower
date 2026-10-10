import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { longDate } from "~/features/common/formatting/utils/date";
import { plural } from "~/features/common/formatting/utils/number";
import { Button } from "~/features/common/ui/components/Button";
import { HelpText } from "~/features/common/ui/components/Field";
import { useToast } from "~/features/common/ui/components/Toast";
import { importsQuery, removeImport } from "~/features/imports/api";
import type { ImportRecord } from "~/features/imports/types";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";

const day = (ts: number) => longDate.format(new Date(ts * 1000));

function covers(i: ImportRecord): string {
  if (!i.first_ts || !i.last_ts) return "Everything it held has since been recorded by WattsMyPower";
  const from = day(i.first_ts);
  const to = day(i.last_ts - 1);
  const replaced = i.replaced_days
    ? ` · replaced what was recorded on ${i.replaced_days} ${plural(i.replaced_days, "day")}`
    : "";
  return `${from === to ? from : `${from} to ${to}`} · ${i.days} ${plural(i.days, "day")}${replaced}`;
}

/** Manage → Integrations → Inverters → Import: what's been imported, each removable without touching recorded history. */
export function PastImports() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery(importsQuery);
  const [confirming, setConfirming] = useState<number | null>(null);
  const remove = useMutation({
    mutationFn: removeImport,
    onSuccess: () => {
      toast("Import removed.");
      setConfirming(null);
      qc.invalidateQueries();
    },
  });
  if (!data?.length) return null;
  return (
    <SettingsCard aria-labelledby="h-imports">
      <div className="border-b border-line-subtle p-6">
        <SettingsTitle
          id="h-imports"
          title="Imported history"
          sub="Removing an import deletes only what it added. Readings WattsMyPower recorded itself stay."
        />
      </div>
      {data.map((i) => (
        <div
          key={i.id}
          className="flex flex-wrap items-center gap-4 border-b border-line-subtle px-6 py-4 last:border-b-0"
        >
          <div className="flex min-w-[220px] flex-1 flex-col gap-0.5">
            <span className="text-[15px] font-semibold break-all">{i.label}</span>
            <span className="text-[13px] text-ink-muted">
              {covers(i)} · imported {day(i.created_at)}
              {i.files > 1 && ` from ${i.files} files`}
            </span>
          </div>
          {confirming === i.id ? (
            <div className="flex flex-wrap items-center gap-3">
              {i.replaced_days > 0 && (
                <HelpText className="basis-full">What WattsMyPower recorded on those days comes back.</HelpText>
              )}
              <Button variant="outline" size="sm" onClick={() => remove.mutate(i.id)} disabled={remove.isPending}>
                {remove.isPending ? "Removing…" : `Remove ${i.days} ${plural(i.days, "day")}`}
              </Button>
              <Button variant="muted-link" size="sm" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setConfirming(i.id)}>
              Remove
            </Button>
          )}
        </div>
      ))}
      {remove.isError && (
        <div className="px-6 pb-4">
          <HelpText tone="bad">{errorMessage(remove.error)}</HelpText>
        </div>
      )}
    </SettingsCard>
  );
}
