import { useQuery } from "@tanstack/react-query";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { useForecast } from "~/features/common/weather/hooks";
import { useLiveDay, useLiveHero } from "~/features/live/hooks";
import { gridQuery } from "~/features/grid/api";
import {
  GridAlert,
  OutagesNearby,
  RadiusPicker,
  VoltageToday,
  WarningsNow,
  WholesaleCard,
} from "~/features/grid/components/GridCards";
import { useGridHero } from "~/features/grid/components/GridSky";
import { useGridDay } from "~/features/grid/hooks";

/**
 * The grid. Its top card is the one the live pages share (its part is useGridHero): the street and the line to your
 * meter in the sky, what today's cost so far, what's flowing now and at what price, and the day's chart with the price
 * under it. Under it, when the grid isn't normal, its own card on what to do and why; how far around the house to
 * look for outages and fires; then four simple cards: the wholesale market today, outages nearby, weather and fire
 * warnings, and the voltage today.
 */
export function GridPage() {
  const { now } = useLiveDay();
  const p = useSnapshot();
  const s = useSystem();
  const { data: grid, isError } = useQuery(gridQuery);
  const { start, series } = useGridDay(now);
  const f = useForecast();
  useLiveHero(useGridHero({ grid, p, s, series, f }));
  const radius = grid?.outages?.network
    ? grid.outages.radius_km
    : grid?.hazards?.fires_followed
      ? grid.hazards.radius_km
      : null;
  return (
    <>
      {grid && grid.outlook.level !== "normal" && <GridAlert grid={grid} p={p} s={s} />}
      {radius != null && <RadiusPicker radius={radius} />}
      {/* Four cards two by two (four across leaves each too narrow for its lines), one under another on a phone. */}
      <div className="@container">
        <div className="grid grid-cols-2 gap-4 @max-xl:grid-cols-1">
          {grid ? (
            <WholesaleCard grid={grid} start={start} now={now} f={f} />
          ) : (
            <Skeleton className="h-[220px] rounded-[22px]" />
          )}
          {grid?.outages ? (
            <OutagesNearby view={grid.outages} now={now} />
          ) : (
            !grid && <Skeleton className="h-[220px] rounded-[22px]" />
          )}
          {grid?.hazards && <WarningsNow view={grid.hazards} now={now} />}
          <VoltageToday series={series} p={p} grid={grid} />
        </div>
      </div>
      {isError && !grid && (
        <div className="text-sm text-ink-faint">Couldn't load the grid's figures. Try again in a moment.</div>
      )}
    </>
  );
}
