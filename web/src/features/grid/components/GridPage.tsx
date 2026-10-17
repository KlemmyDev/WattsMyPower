import { useQuery } from "@tanstack/react-query";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { Card } from "~/features/common/ui/components/Card";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { useLiveDay, useLiveHero } from "~/features/live/hooks";
import { gridQuery } from "~/features/grid/api";
import { OutagesNearby, VoltageToday, WarningsNow, WholesaleCard } from "~/features/grid/components/GridCards";
import { Warnings } from "~/features/grid/components/GridHero";
import { useGridHero } from "~/features/grid/components/GridSky";
import { useGridDay } from "~/features/grid/hooks";

/**
 * The grid. Its top card is the one the live pages share (its part is useGridHero): the street and the line to your
 * meter in the sky, what today's cost so far, what's flowing now and at what price, and the day's chart with the price
 * under it. Under it, when the grid isn't normal, what to do and why; then three simple cards side by side: the
 * wholesale market today, outages nearby and the voltage today, with weather and fire warnings after them while there
 * are any.
 */
export function GridPage() {
  const { now } = useLiveDay();
  const p = useSnapshot();
  const s = useSystem();
  const { data: grid, isError } = useQuery(gridQuery);
  const { start, series } = useGridDay(now);
  useLiveHero(useGridHero({ grid, p, s, series }));
  return (
    <>
      {grid && grid.outlook.level !== "normal" && (
        <Card>
          <Warnings grid={grid} p={p} s={s} />
        </Card>
      )}
      {/* Three across, two on a narrower page, one on a phone. */}
      <div className="@container">
        <div className="grid grid-cols-3 gap-4 @max-4xl:grid-cols-2 @max-xl:grid-cols-1">
          {grid ? (
            <WholesaleCard grid={grid} start={start} now={now} />
          ) : (
            <Skeleton className="h-[220px] rounded-[22px]" />
          )}
          {grid?.outages ? (
            <OutagesNearby view={grid.outages} now={now} />
          ) : (
            !grid && <Skeleton className="h-[220px] rounded-[22px]" />
          )}
          <VoltageToday series={series} p={p} grid={grid} />
          {grid?.hazards && <WarningsNow view={grid.hazards} now={now} />}
        </div>
      </div>
      {isError && !grid && (
        <div className="text-sm text-ink-faint">Couldn't load the grid's figures. Try again in a moment.</div>
      )}
    </>
  );
}
