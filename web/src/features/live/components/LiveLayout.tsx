import { useQuery } from "@tanstack/react-query";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { InverterNotice } from "~/features/common/layout/components/InverterNotice";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { historyQuery } from "~/features/common/readings/api";
import { useNow } from "~/features/common/time/hooks";
import { addDays, dateKey, midnight } from "~/features/common/time/utils";
import { sunDay } from "~/features/common/time/utils/sun";
import { useForecast } from "~/features/common/weather/hooks";
import { LiveCard } from "~/features/live/components/LiveCard";
import { DayContext, HeroContext } from "~/features/live/hooks";
import type { LiveDay, LiveHero } from "~/features/live/types";
import { expectedToday, place } from "~/features/solar/utils";
import { weatherDayQuery } from "~/features/weather/api";

/** What the scene needs of the day: the panels' power, the battery's power and level, and the grid's. */
const SCENE_FIELDS = ["pv_power", "battery_power", "battery_soc", "grid_power"];

/**
 * The live pages (Solar, Battery; EV, Grid and Home to come), around one top card they share (LiveCard): opening one
 * from another keeps the card where it is and flies its camera to the new page's spot, rather than opening a new page.
 * Each page gives the card its words, figures and chart (useLiveHero) and draws its own cards under it, which rise in
 * one after another as it opens. The day they share (useLiveDay) is read here once.
 */
export function LiveLayout() {
  const now = useNow(30_000);
  const s = useSystem();
  const f = useForecast();
  const start = midnight(now);
  const { data: weather } = useQuery(weatherDayQuery(dateKey(now)));
  const { data } = useQuery(
    historyQuery({ start, end: addDays(start, 1), points: 288, fields: SCENE_FIELDS, live: true }),
  );
  const at = place(s);
  const sun = at ? sunDay(start + 43_200, at.lat, at.lon) : null;
  const rise = sun?.rise ?? start + 6 * 3600;
  const set = sun?.set ?? start + 18 * 3600;
  const series = data?.series;
  const expected = useMemo(() => expectedToday(weather, f, now), [weather, f, now]);
  const day = useMemo<LiveDay>(
    () => ({ now, start, rise, set, sunKnown: sun != null, series, weather, expected }),
    [now, start, rise, set, sun, series, weather, expected],
  );
  const [hero, setHero] = useState<LiveHero | null>(null);
  const path = useRouterState({ select: (r) => r.location.pathname });
  return (
    <HeroContext.Provider value={setHero}>
      <DayContext.Provider value={day}>
        {hero && (
          <>
            <InverterNotice />
            <LiveCard hero={hero} day={day} />
          </>
        )}
        <div key={path} className="live-enter flex flex-col gap-5">
          <Outlet />
        </div>
      </DayContext.Provider>
    </HeroContext.Provider>
  );
}
