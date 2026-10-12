import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "~/features/common/api/utils";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useNow } from "~/features/common/time/hooks";
import { addDays } from "~/features/common/time/utils";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Card } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { useForecast } from "~/features/common/weather/hooks";
import { homeInsightsQuery, homeQuery, homeUsageQuery } from "~/features/home/api";
import { HomeHero } from "~/features/home/components/HomeHero";
import { HomeDaysCard, HomeSourcesCard, useHomeDays, useHomeToday } from "~/features/home/components/HomeWhole";
import { HabitsCard, StandbyCard } from "~/features/home/components/InsightCards";
import { RoomsNow } from "~/features/home/components/RoomTiles";
import { RunningNowCard } from "~/features/home/components/RunningNowCard";
import { ChangesCard, GoalsCard } from "~/features/home/components/SummaryCards";
import { deviceColors } from "~/features/home/utils";
import { todayLanes } from "~/features/home/utils/today";

/** Until something's connected: what the page will show, and where to connect it. */
function ConnectPrompt() {
  return (
    <Card aria-labelledby="h-connect" className="col-span-12 flex-row flex-wrap items-center gap-5">
      <span className="flex size-12 flex-none items-center justify-center rounded-full bg-canvas text-ink">
        <Icon name="washer" size={24} />
      </span>
      <div className="flex min-w-[240px] flex-1 flex-col gap-1">
        <h2 id="h-connect">See what each appliance uses</h2>
        <span className="text-sm text-pretty text-ink-muted">
          Connect a smart plug or appliance to see its share of your home's use, and when it usually runs. Tapo, Shelly,
          Home Assistant, Hisense, Bluetti and EcoFlow all work.
        </span>
      </div>
      <ButtonLink to="/integrations" hash="smart-home" variant="primary">
        Connect an appliance
      </ButtonLink>
    </Card>
  );
}

/**
 * Home, live: today and now in one card (what the house has used and is drawing, against a usual day, with the day's
 * chart, the rates and a lane per room, hour by hour), what's running, each room lit by what it draws now (each opening
 * its page), the last 30 days and where today's came from, and what's been learned from the devices.
 */
export function HomePage() {
  const now = useNow(60_000);
  const overview = useQuery(homeQuery);
  const p = useSnapshot();
  const f = useForecast();
  const { today, series } = useHomeToday(now);
  const homeDays = useHomeDays(now);
  const usage = useQuery(homeUsageQuery(today, addDays(today, 1), "hour"));
  const found = useQuery(homeInsightsQuery);
  const devices = overview.data?.devices ?? [];
  const rooms = overview.data?.rooms ?? [];
  const running = devices.filter((d) => !d.hidden && d.now?.running && !d.now.stale);
  const problems = (overview.data?.integrations ?? []).filter((i) => i.account?.error);

  return (
    <>
      <PageHeader
        title="Home"
        sub={
          running.length
            ? `${running.map((d) => d.name).join(" and ")} ${running.length === 1 ? "is" : "are"} running now`
            : "Where your home's power goes"
        }
      />
      {overview.error && <Notice>{errorMessage(overview.error)}</Notice>}
      {problems.map((i) => (
        <Notice key={i.id} tone="warn" className="flex flex-wrap items-center justify-between gap-3">
          <span>
            {i.name}: {i.account!.error}
          </span>
          <ButtonLink to="/integrations/home/$integration" params={{ integration: i.id }} size="sm" variant="outline">
            {i.account!.signed_out ? "Sign in again" : "Check it"}
          </ButtonLink>
        </Notice>
      ))}
      <div className="flex flex-col gap-5">
        <HomeHero p={p} f={f} series={series} start={today} now={now} lanes={todayLanes(usage.data, devices, rooms)} />
        <RunningNowCard />
        {overview.data && !devices.length && <ConnectPrompt />}
        {devices.length > 0 && (
          <RoomsNow
            devices={devices}
            rooms={rooms}
            kinds={overview.data?.kinds}
            best={found.data?.best_times}
            load={p?.load_power}
            now={now}
          />
        )}
        <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1">
          <HomeDaysCard days={homeDays} />
          <HomeSourcesCard series={series} p={p} days={homeDays} />
        </div>
        {devices.length > 0 && (
          <div className="grid grid-cols-12 gap-5">
            <ChangesCard changes={found.data?.changes} />
            <GoalsCard standbyW={found.data?.standby.home_w} />
            <StandbyCard standby={found.data?.standby} devices={devices} colors={deviceColors(devices, rooms)} />
            <HabitsCard unexplained={found.data?.unexplained} />
          </div>
        )}
      </div>
    </>
  );
}
