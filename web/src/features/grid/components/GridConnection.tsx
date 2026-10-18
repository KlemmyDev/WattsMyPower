import { useQuery } from "@tanstack/react-query";
import { duration, hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { useLive } from "~/features/common/live/hooks/useLive";
import { useNow } from "~/features/common/time/hooks";
import { midnight, sameDay } from "~/features/common/time/utils";
import { Card, Muted, TitleBlock } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { gridEventsQuery } from "~/features/grid/api";

/** Whether the house is on the grid or running without it, from the live status: null when this inverter doesn't say. */
export function useGridConnection() {
  const s = useLive();
  return { offGrid: s?.off_grid ?? null, since: s?.off_grid_since ?? null, healthy: s?.grid_healthy ?? null };
}

/** "3:12 pm", or "Sat 17 Oct, 3:12 pm" when it wasn't today. */
const at = (ts: number, now: number) => `${ts >= midnight(now) ? "" : `${shortDay.format(ts * 1000)}, `}${hhmm(ts)}`;

/** A small status for the Grid page: "On the grid", or red "Off grid since 3:12 pm". Nothing if it isn't reported. */
export function ConnectionPill({ className }: { className?: string }) {
  const { offGrid, since, healthy } = useGridConnection();
  const now = useNow(30_000);
  if (offGrid == null) return null;
  return (
    <span
      role="status"
      className={cn(
        "inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-[13px]",
        offGrid ? "border-bad/40 bg-bad-subtle text-bad" : "border-fg/8 bg-fg/4 text-ink-muted",
        className,
      )}
    >
      <i
        className={cn("size-2 rounded-full", offGrid ? "bg-bad" : healthy === false ? "bg-warn" : "bg-good")}
        aria-hidden
      />
      {offGrid
        ? `Off grid${since ? ` since ${at(since, now)}` : ""}`
        : healthy
          ? "On the grid, supply normal"
          : healthy === false
            ? "On the grid, supply outside its normal range"
            : "On the grid"}
    </span>
  );
}

/** Across the top of the Grid page while the house is running without the grid. */
export function OffGridBanner() {
  const { offGrid, since } = useGridConnection();
  const now = useNow(30_000);
  if (!offGrid) return null;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-[22px] bg-bad-subtle px-5 py-4 text-bad">
      <Icon name="grid" size={20} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] font-semibold">You're off grid</span>
        <span className="text-[13px] text-ink-body">
          Your inverter is running the house on solar and the battery
          {since ? `, since ${at(since, now)} (${duration(Math.max(60, now - since))})` : ""}. The battery's level and
          what's running are on the Battery page.
        </span>
      </div>
    </div>
  );
}

/** Each time the house ran without the grid, newest first, with how long. Nothing if the inverter doesn't report it. */
export function OffGridHistory({ className }: { className?: string }) {
  const { data } = useQuery(gridEventsQuery);
  const now = useNow(60_000);
  if (!data?.known) return null;
  return (
    <Card aria-labelledby="h-offgrid" className={className}>
      <TitleBlock
        id="h-offgrid"
        title="Off-grid history"
        sub="Each time your inverter ran the house without the grid"
      />
      {data.events.length === 0 ? (
        <Muted>None recorded yet. Any blackout from now on will be listed here, with how long it lasted.</Muted>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-line-subtle p-0">
          {data.events.map((e) => (
            <li key={e.id} className="flex items-baseline justify-between gap-3 py-2.5">
              <span className="flex min-w-0 flex-col">
                <span className="text-[14px]">{at(e.start, now)}</span>
                <span className="text-xs text-ink-muted">
                  {e.end == null
                    ? "Still off grid"
                    : `Grid back at ${sameDay(e.start, e.end) ? hhmm(e.end) : at(e.end, now)}`}
                </span>
              </span>
              <span className="text-[15px] font-light whitespace-nowrap tabular-nums">
                {duration(Math.max(60, (e.end ?? now) - e.start))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
