import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { errorMessage } from "~/features/common/api/utils";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { STORE_HOME_COMPARE, STORE_HOME_RANGE, STORE_HOME_VIEW, store } from "~/features/common/storage/utils";
import { addDays, dateKey, midnight } from "~/features/common/time/utils";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { useNow } from "~/features/common/time/hooks";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useForecast } from "~/features/common/weather/hooks";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Card } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { homeInsightsQuery, homePatternsQuery, homeQuery, homeUsageQuery } from "~/features/home/api";
import { DeviceCard, GroupCard } from "~/features/home/components/DeviceCard";
import {
  HomeDaysCard,
  HomeNow,
  HomeSourcesCard,
  HomeTodayCard,
  useHomeDays,
  useHomeToday,
} from "~/features/home/components/HomeWhole";
import { HabitsCard, StandbyCard } from "~/features/home/components/InsightCards";
import { NowCard } from "~/features/home/components/NowCard";
import { ChangesCard, GoalsCard } from "~/features/home/components/SummaryCards";
import { UsageCard, type Range } from "~/features/home/components/UsageCard";
import {
  BEFORE_WORDS,
  beforeWords,
  dayWords,
  deviceColors,
  drawing,
  givenDeviceColor,
  givenRoomColor,
  groupPattern,
  groupUsage,
  homeItems,
  period,
  RANGE_WORDS,
  roomLook,
} from "~/features/home/utils";

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
 * Home, live: what the house is drawing now and where from, then today against a usual day beside what each room is
 * drawing this minute; where the power went over a day or the last 7 or 30 days, split between the devices connected
 * (smart appliances, plugs), the car and everything else; each room and device; and what's been learned from them.
 */
export function HomePage({ range, day }: { range: Range; day?: number }) {
  const navigate = useNavigate();
  const now = useNow(60_000);
  const [start, end, bucket] = period(range, now, day);
  // The period shown in words ("today", "on Mon 6 Oct", "in 7 days"), and what it's compared with.
  const rangeWords = range === "today" ? dayWords(start, now) : RANGE_WORDS[range];
  const [compare, setCompare] = useState(() => store.get(STORE_HOME_COMPARE) === "1");
  const overview = useQuery(homeQuery);
  const p = useSnapshot();
  const f = useForecast();
  const { today, series: wholeSeries } = useHomeToday(now);
  const whole = { series: wholeSeries };
  const homeDays = useHomeDays(now);
  // While another day or period loads, the last one stays on screen (dimmed) rather than the card emptying.
  const usage = useQuery({ ...homeUsageQuery(start, end, bucket), placeholderData: keepPreviousData });
  // The period before, to compare each device with (by the day, for 7 or 30 days).
  const before = useQuery({ ...homeUsageQuery(2 * start - end, start, "day"), enabled: range !== "today" });
  // What the chart overlays when comparing: the day before, by the hour, or that same period before.
  const previous = useQuery({
    ...(range === "today"
      ? homeUsageQuery(addDays(start, -1), start, "hour")
      : homeUsageQuery(2 * start - end, start, "day")),
    enabled: compare,
  });
  const patterns = useQuery(homePatternsQuery);
  const found = useQuery(homeInsightsQuery);
  const devices = overview.data?.devices ?? [];
  const rooms = overview.data?.rooms ?? [];
  // Each device's colour; and where rooms are shown as one, each room's (its own, standing in by its first device).
  const colors = deviceColors(devices, rooms);
  const roomColors = deviceColors(devices, rooms, { byRoom: true });
  const visible = devices.filter((d) => !d.hidden);
  for (const d of devices)
    if (d.hidden) {
      colors.delete(d.id);
      roomColors.delete(d.id);
    }
  const kinds = new Map((overview.data?.kinds ?? []).map((k) => [k.id, k]));
  const kindLabels = new Map([...kinds].map(([id, k]) => [id, k.label]));
  // By room, grouped devices (the plugs in a room) are shown as one, in the breakdown and as a card; by device, each
  // on its own.
  const [view, setView] = useState<"rooms" | "devices">(() =>
    store.get(STORE_HOME_VIEW) === "devices" ? "devices" : "rooms",
  );
  const hasRooms = devices.some((d) => d.group && !d.hidden);
  const byRoom = view === "rooms" || !hasRooms;
  const items = homeItems(devices, byRoom);
  const itemColors = byRoom ? roomColors : colors;
  const on = items.filter((i) => i.members.some((d) => drawing(d) != null || (d.now?.running && !d.now.stale)));
  const offline = items.filter((i) => i.members.every((d) => !d.now || !d.now.online || d.now.stale));
  const used = usage.data && groupUsage(usage.data, items);
  const previousUsed = compare && previous.data ? groupUsage(previous.data, items) : undefined;
  const earlier = before.data && range !== "today" ? groupUsage(before.data, items) : undefined;
  const beforeOf = (id: number) => (earlier ? (earlier.devices.find((u) => u.id === id)?.total ?? 0) : undefined);
  const running = visible.filter((d) => d.now?.running && !d.now.stale);
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
        <HomeNow p={p} f={f} series={whole?.series} now={now} />
        <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1">
          <div className="flex min-w-0 flex-col gap-5">
            <HomeTodayCard series={whole?.series} f={f} start={today} now={now} />
            <HomeDaysCard days={homeDays} />
          </div>
          {/* One column, what's happening now comes first. */}
          <div className="flex min-w-0 flex-col gap-5 max-3xl:order-first">
            {devices.length > 0 && <NowCard devices={devices} colors={roomColors} load={p?.load_power} />}
            <HomeSourcesCard series={whole?.series} p={p} days={homeDays} />
          </div>
        </div>
        <div className="grid grid-cols-12 gap-5">
          <UsageCard
            usage={used}
            colors={itemColors}
            range={range}
            rangeWords={rangeWords}
            onRange={(r) => {
              store.set(STORE_HOME_RANGE, r); // opened again (or refreshed) later, it shows this period
              void navigate({ to: "/home", search: { range: r }, replace: true });
            }}
            day={start}
            today={midnight(now)}
            onDay={(d) =>
              void navigate({
                to: "/home",
                search: { range: "today", day: d >= midnight(now) ? undefined : dateKey(d) },
                replace: true,
              })
            }
            compare={compare}
            onCompare={(on) => {
              setCompare(on);
              store.set(STORE_HOME_COMPARE, on ? "1" : "");
            }}
            previous={previousUsed}
            loading={usage.isPlaceholderData}
            previousWords={beforeWords(range, start, now)}
          />
          {overview.data && !devices.length && <ConnectPrompt />}
          {devices.length > 0 && (
            <div className="col-span-12 flex flex-wrap items-end justify-between gap-3 pt-4">
              <div className="flex flex-col gap-1">
                <h2>{byRoom && hasRooms ? "Rooms and devices" : "Devices"}</h2>
                <span className="text-[13px] text-ink-muted">
                  {[
                    on.length ? `${on.length} drawing power now` : "Nothing drawing power now",
                    offline.length ? `${offline.length} offline` : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  . Choose an icon to change its look.
                </span>
              </div>
              {hasRooms && (
                <Segmented
                  label="Show"
                  options={[
                    { value: "rooms", label: "By room" },
                    { value: "devices", label: "By device" },
                  ]}
                  value={view}
                  onChange={(v) => {
                    setView(v);
                    store.set(STORE_HOME_VIEW, v);
                  }}
                />
              )}
            </div>
          )}
          {items.length > 0 && (
            <div className="col-span-12 grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-5">
              {items.map((item) =>
                item.group ? (
                  <GroupCard
                    key={`group:${item.group}`}
                    name={item.group}
                    members={item.members}
                    used={used?.devices.find((u) => u.id === item.id)}
                    before={beforeOf(item.id)}
                    pattern={patterns.data && groupPattern(patterns.data, item)}
                    cycles={item.members.every((d) => kinds.get(d.kind)?.cycles)}
                    kindLabels={kindLabels}
                    color={itemColors.get(item.id)!}
                    givenColor={givenRoomColor(devices, rooms, item.group)}
                    colors={colors}
                    look={roomLook(rooms, item.group)}
                    home={usage.data?.total.home ?? null}
                    rangeLabel={rangeWords}
                    beforeLabel={BEFORE_WORDS[range]}
                  />
                ) : (
                  <DeviceCard
                    key={item.id}
                    device={item.members[0]}
                    used={used?.devices.find((u) => u.id === item.id)}
                    before={beforeOf(item.id)}
                    pattern={patterns.data?.find((p) => p.id === item.id)}
                    cycles={!!kinds.get(item.members[0].kind)?.cycles}
                    kindLabel={kindLabels.get(item.members[0].kind) ?? "Device"}
                    color={itemColors.get(item.id)!}
                    givenColor={givenDeviceColor(devices, rooms, item.id)}
                    home={usage.data?.total.home ?? null}
                    rangeLabel={rangeWords}
                    beforeLabel={BEFORE_WORDS[range]}
                    best={found.data?.best_times.find((b) => b.id === item.id)}
                    saving={found.data?.savings.find((x) => x.id === item.id)}
                  />
                ),
              )}
            </div>
          )}
          {devices.length > 0 && (
            <>
              <ChangesCard changes={found.data?.changes} />
              <GoalsCard standbyW={found.data?.standby.home_w} />
              <StandbyCard standby={found.data?.standby} devices={devices} colors={colors} />
              <HabitsCard unexplained={found.data?.unexplained} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
