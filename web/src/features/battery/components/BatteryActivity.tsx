import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { batteryLogQuery } from "~/features/battery/api";
import type { BatteryEvent } from "~/features/battery/types";
import { KIND_COLOR, when } from "~/features/battery/utils";
import { hhmm, shortDay, weekdayLong } from "~/features/common/formatting/utils/date";
import { COLOR } from "~/features/common/theme/utils/colors";
import { addDays, midnight } from "~/features/common/time/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Card } from "~/features/common/ui/components/Card";
import { cn } from "~/features/common/ui/utils";

const FIRST = 8; // shown to start with
const MORE = 12; // added by each "Show more"
const MOST = 200; // all the server keeps

/** "Today", "Yesterday", a weekday within the week, else the date. */
function dayName(ts: number, now: number): string {
  const d = midnight(ts);
  if (d === midnight(now)) return "Today";
  if (d === addDays(midnight(now), -1)) return "Yesterday";
  if (d > addDays(midnight(now), -7)) return weekdayLong.format(new Date(ts * 1000));
  return shortDay.format(new Date(ts * 1000));
}

/**
 * What the battery controls did, and what was seen of iSolarCloud and other controllers, newest first and grouped by
 * day; each with its control's colour as on the chart. The latest few to start with, more on asking.
 */
export function BatteryActivity({ now, className }: { now: number; className?: string }) {
  const [shown, setShown] = useState(FIRST);
  // One more than shown, to know whether there are more.
  const { data, isPending } = useQuery({ ...batteryLogQuery(shown + 1), placeholderData: keepPreviousData });
  const events = data?.events ?? [];
  const more = events.length > shown;
  const days: [string, BatteryEvent[]][] = [];
  for (const e of events.slice(0, shown)) {
    const name = dayName(e.ts, now);
    const last = days[days.length - 1];
    if (last && last[0] === name) last[1].push(e);
    else days.push([name, [e]]);
  }
  return (
    <Card aria-labelledby="h-batlog" className={cn("gap-4", className)}>
      <div className="flex flex-col gap-0.5">
        <h2 id="h-batlog">Activity</h2>
        <span className="text-[13px] text-ink-muted">What the battery was set to do, here and in iSolarCloud</span>
      </div>
      {!isPending && events.length === 0 && (
        <p className="m-0 text-sm text-ink-muted">
          Nothing yet. Controls you start, and ones from iSolarCloud, show here.
        </p>
      )}
      {days.map(([name, list]) => (
        <div key={name} className="flex flex-col gap-2">
          <span className="font-mono text-[11px] tracking-[1.5px] text-ink-faint uppercase">{name}</span>
          <ol className="m-0 flex list-none flex-col p-0">
            {list.map((e, i) => (
              <li key={`${e.ts}-${e.text}`} className="relative flex gap-3 pb-3 last:pb-0">
                {/* A timeline: each event's dot, joined to the next. */}
                <span className="relative flex w-3 flex-none justify-center">
                  <span
                    aria-hidden
                    className="z-1 mt-1.5 size-2.5 rounded-full ring-4 ring-surface"
                    style={{ background: e.kind ? KIND_COLOR[e.kind] : COLOR.inkMuted }}
                  />
                  {i < list.length - 1 && <span aria-hidden className="absolute top-3 -bottom-1.5 w-px bg-line" />}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13px] text-pretty">
                    {e.text}
                    {e.until ? ` until ${when(e.until, e.ts)}` : ""}
                  </span>
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
