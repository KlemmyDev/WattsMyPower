import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { HelpText, Input } from "~/features/common/ui/components/Field";
import { Switch } from "~/features/common/ui/components/Switch";
import { notificationsQuery, saveOptions } from "~/features/notifications/api";
import type { Options } from "~/features/notifications/types";
import { OptionList, OptionRow, SettingsSection } from "~/features/settings/components/SettingsSection";

/** Quiet hours and the day's limit: they hold back everything but the urgent. */
export function OptionsCard({ options }: { options: Options }) {
  const qc = useQueryClient();
  const [quiet, setQuiet] = useState(options.quiet);
  const [cap, setCap] = useState(String(options.daily_cap));
  const dirty =
    quiet.enabled !== options.quiet.enabled ||
    quiet.start !== options.quiet.start ||
    quiet.end !== options.quiet.end ||
    Number(cap) !== options.daily_cap;
  const save = useMutation({
    mutationFn: () => saveOptions({ quiet, daily_cap: Number(cap) }),
    onSuccess: (fresh) => qc.setQueryData(notificationsQuery.queryKey, fresh),
  });
  return (
    <SettingsSection
      id="h-options"
      title="Quiet hours and limits"
      sub="Keeps it from being noisy. Urgent ones, like the grid going down, still come through."
    >
      <OptionList>
        <OptionRow label="Quiet hours" help="Nothing is sent between these times (it's kept in the history).">
          <div className="flex flex-wrap items-center gap-3">
            <Switch on={quiet.enabled} label="Quiet hours" onChange={(enabled) => setQuiet({ ...quiet, enabled })} />
            <Input
              type="time"
              aria-label="Quiet hours start"
              value={quiet.start}
              disabled={!quiet.enabled}
              onChange={(e) => setQuiet({ ...quiet, start: e.target.value })}
              boxClassName="h-9"
            />
            <span className="text-[13px] text-ink-muted">to</span>
            <Input
              type="time"
              aria-label="Quiet hours end"
              value={quiet.end}
              disabled={!quiet.enabled}
              onChange={(e) => setQuiet({ ...quiet, end: e.target.value })}
              boxClassName="h-9"
            />
          </div>
        </OptionRow>
        <OptionRow label="Most in a day" help="After this many in a day, the rest are held back until tomorrow.">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={200}
            aria-label="Most notifications in a day"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            boxClassName="h-9 w-28"
          />
        </OptionRow>
      </OptionList>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        {save.isError && <HelpText tone="bad">{errorMessage(save.error)}</HelpText>}
      </div>
    </SettingsSection>
  );
}
