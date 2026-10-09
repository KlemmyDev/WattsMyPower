import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { hhmm, shortDay, weekdayLong } from "~/features/common/formatting/utils/date";
import { COLOR } from "~/features/common/theme/utils/colors";
import { addDays, midnight } from "~/features/common/time/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Card } from "~/features/common/ui/components/Card";
import { cn } from "~/features/common/ui/utils";
import { teslaLogQuery } from "~/features/ev/api";
import type { EvEvent } from "~/features/ev/types";
import { EVENT_COLOR } from "~/features/ev/utils";

const FIRST = 8;
const MORE = 12;
const MOST = 200;

function dayName(ts: number, now: number): string {
  const d = midnight(ts);
  if (d === midnight(now)) return "Today";
  if (d === addDays(midnight(now), -1)) return "Yesterday";
  if (d > addDays(midnight(now), -7)) return weekdayLong.format(new Date(ts * 1000));
  return shortDay.format(new Date(ts * 1000));
}

/** What the dashboard told the cars, and what it saw done in the car's app, newest first and grouped by day. */
export function EvActivity({ now, vin, className }: { now: number; vin?: string; className?: string }) {
  const [shown, setShown] = useState(FIRST);
  const { data, isPending } = useQuery({ ...teslaLogQuery(shown + 1), placeholderData: keepPreviousData });
  const events = (data?.events ?? []).filter((e) => !vin || e.vin === vin);
  const more = events.length > shown;
  const days: [string, EvEvent[]][] = [];
  for (const e of events.slice(0, shown)) {
    const name = dayName(e.ts, now);
    const last = days[days.length - 1];
    if (last && last[0] === name) last[1].push(e);
    else days.push([name, [e]]);
  }
  return (
    <Card aria-labelledby="h-tlog" className={cn("gap-4", className)}>
      <div className="flex flex-col gap-0.5">
        <h2 id="h-tlog">Activity</h2>
        <span className="text-[13px] text-ink-muted">What the dashboard told the car, and what it saw you do</span>
      </div>
      {!isPending && events.length === 0 && (
        <p className="m-0 text-sm text-ink-muted">
          Nothing yet. Choose how the car charges and what it does shows here.
        </p>
      )}
      {days.map(([name, list]) => (
        <div key={name} className="flex flex-col gap-2">
          <span className="text-[13px] font-medium text-ink-faint">{name}</span>
          <ol className="m-0 flex list-none flex-col p-0">
            {list.map((e, i) => (
              <li key={`${e.ts}-${i}`} className="relative flex gap-3 pb-3 last:pb-0">
                <span className="relative flex w-3 flex-none justify-center">
                  <span
                    aria-hidden
                    className="z-1 mt-1.5 size-2.5 rounded-full ring-4 ring-surface"
                    style={{ background: e.kind ? EVENT_COLOR[e.kind] : COLOR.inkMuted }}
                  />
                  {i < list.length - 1 && <span aria-hidden className="absolute top-3 -bottom-1.5 w-px bg-line" />}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13px] text-pretty">{e.text}</span>
                  <span className="text-xs text-ink-faint tabular-nums">{hhmm(e.ts)}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      ))}
      {more && shown < MOST && (
        <Button
          variant="muted-link"
          size="sm"
          className="self-start"
          onClick={() => setShown((n) => Math.min(MOST, n + MORE))}
        >
          Show more
        </Button>
      )}
    </Card>
  );
}
