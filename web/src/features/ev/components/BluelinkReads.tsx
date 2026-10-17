import { errorMessage } from "~/features/common/api/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { useNow } from "~/features/common/time/hooks";
import { Button } from "~/features/common/ui/components/Button";
import { HelpText } from "~/features/common/ui/components/Field";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { CardText, SmallCard } from "~/features/common/ui/components/SmallCard";
import { useBluelinkChange, useEvChange } from "~/features/ev/hooks";
import type { BluelinkCar } from "~/features/ev/types";
import { appName, EVENT_COLOR } from "~/features/ev/utils";

const EVERY: Record<number, string> = { 0: "Never", 14400: "4 h", 7200: "2 h", 3600: "1 h" };

/**
 * How a Hyundai or Kia is read, and what the dashboard did with it lately. Its cloud only has what the car last sent
 * (when it's plugged in or out, starts or stops, takes a command): asking the car itself wakes its modem and draws on
 * its 12 V battery, so it's done rarely (by day, in Spare solar mode, as often as chosen here) or from the button.
 */
export function BluelinkReads({ v, choices, className }: { v: BluelinkCar; choices: number[]; className?: string }) {
  const { refresh } = useBluelinkChange();
  const { configure } = useEvChange("bluelink");
  const now = useNow(5_000);
  const app = appName(v.make);
  const wait = v.force_from != null && v.force_from > now;
  return (
    <SmallCard id={`h-bl-${v.vin}`} title="Reading the car" note={`Through ${app}`} className={className}>
      <CardText>
        Every 15 minutes (every 5 while it could charge from solar), the dashboard reads what {app} last heard from the
        car, without touching the car. The car only sends its state when it's plugged in or out, starts or stops, or
        takes a command, so its charge can lag in between.
      </CardText>
      <div className="flex flex-col gap-2.5 border-t border-line-subtle pt-3.5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className="text-sm font-medium">Ask the car itself</span>
          <Segmented
            label="Ask the car itself"
            options={choices.map((c) => ({ value: String(c), label: EVERY[c] ?? `${c / 3600} h` }))}
            value={String(v.control.force_every)}
            onChange={(value) => configure.mutate({ vin: v.vin, force_every: Number(value) })}
            buttonClassName="px-3 py-1.5 text-[13px]"
          />
        </div>
        <CardText>
          {v.control.force_every
            ? `By day in Solar only mode, if what ${app} has is older than this, the car's asked for its state, so the dashboard knows it's plugged in and how full it is. Each ask wakes the car's modem and draws a little on its 12 V battery.`
            : `The dashboard never asks the car. It goes on what the car sends ${app} by itself, so plugging in may not show until the car next sends an update.`}
        </CardText>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            disabled={refresh.isPending || wait}
            onClick={() => refresh.mutate(v.vin)}
          >
            {refresh.isPending ? "Asking the car…" : "Ask it now"}
          </Button>
          <HelpText tone={refresh.isError ? "bad" : undefined}>
            {refresh.isError
              ? errorMessage(refresh.error)
              : wait
                ? `Asked at ${hhmm(v.forced_at!)}. You can ask again from ${hhmm(v.force_from!)}.`
                : v.forced_at
                  ? `Last asked at ${hhmm(v.forced_at)}.`
                  : "Reads it now, from the car."}
          </HelpText>
        </div>
      </div>
      {configure.isError && <HelpText tone="bad">{errorMessage(configure.error)}</HelpText>}
      <div className="flex flex-col gap-2 border-t border-line-subtle pt-3.5">
        <span className="text-sm font-medium">Lately</span>
        {v.events.length ? (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {v.events.map((e) => (
              <li key={`${e.ts}-${e.text}`} className="flex items-baseline gap-2 text-[13px]">
                <span
                  className="size-2 flex-none translate-y-[-1px] rounded-full"
                  style={{ background: e.kind ? EVENT_COLOR[e.kind] : undefined }}
                />
                <span className="text-ink-muted tabular-nums">{hhmm(e.ts)}</span>
                <span className="text-pretty">{e.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <CardText>Nothing yet. Anything the dashboard does with the car will show up here.</CardText>
        )}
      </div>
    </SmallCard>
  );
}
