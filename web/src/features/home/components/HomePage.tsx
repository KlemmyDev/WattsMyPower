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
import { historyQuery } from "~/features/common/readings/api";
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
} from "~/features/home/components/HomeWhole";
import { HabitsCard, StandbyCard } from "~/features/home/components/InsightCards";
import { ChangesCard, GoalsCard, RoomsCard } from "~/features/home/components/SummaryCards";
import { UsageCard, type Range } from "~/features/home/components/UsageCard";
import {
  BEFORE_WORDS,
  beforeWords,
  dayWords,
  deviceColors,
  groupPattern,
  groupUsage,
  homeItems,
  period,
  RANGE_WORDS,
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
          Connect smart plugs and appliances (Tapo, Shelly, Home Assistant, a Hisense washer or dryer, or a Bluetti or
          EcoFlow battery) and each one's share of your home's use shows here, with when it usually runs.
        </span>
      </div>
      <ButtonLink to="/integrations" hash="smart-home" variant="primary">
        Connect an appliance
      </ButtonLink>
    </Card>
  );
}

// The whole house through today, from the inverter: for the cards above the devices.
const WHOLE_FIELDS = ["load_power", "pv_power", "battery_power"];

/**
 * Home: where the home's power goes. Everything the home used, split between the devices connected (smart
 * appliances, plugs) and everything else; then each device with what it's doing, what it used, and its habits.
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
  const today = midnight(now);
  const { data: whole } = useQuery(
    historyQuery({ start: today, end: addDays(today, 1), points: 288, fields: WHOLE_FIELDS, live: true }),
  );
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
  const colors = deviceColors(devices);
  const visible = devices.filter((d) => !d.hidden);
  for (const d of devices) if (d.hidden) colors.delete(d.id);
  const kinds = new Map((overview.data?.kinds ?? []).map((k) => [k.id, k]));
  const kindLabels = new Map([...kinds].map(([id, k]) => [id, k.label]));
  // By room, grouped devices (the plugs in a room) are shown as one, in the breakdown and as a card; by device, each
  // on its own.
  const [view, setView] = useState<"rooms" | "devices">(() =>
    store.get(STORE_HOME_VIEW) === "devices" ? "devices" : "rooms",
  );
  const hasRooms = devices.some((d) => d.group && !d.hidden);
  const items = homeItems(devices, view === "rooms" || !hasRooms);
  const used = usage.data && groupUsage(usage.data, items);
  const previousUsed = compare && previous.data ? groupUsage(previous.data, items) : undefined;
  const earlier = before.data && range !== "today" ? groupUsage(before.data, items) : undefined;
  const beforeOf = (id: number) => (earlier ? (earlier.devices.find((u) => u.id === id)?.total ?? 0) : undefined);
  const rooms = homeItems(devices);
  const roomUse = usage.data && groupUsage(usage.data, rooms);
  const roomsBefore = before.data && range !== "today" ? groupUsage(before.data, rooms) : undefined;
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
      <div className="grid grid-cols-12 gap-5">
        <HomeNow p={p} f={f} series={whole?.series} now={now} />
        <UsageCard
          usage={used}
          colors={colors}
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
        <HomeTodayCard series={whole?.series} f={f} start={today} now={now} />
        <HomeSourcesCard series={whole?.series} p={p} days={homeDays} />
        <HomeDaysCard days={homeDays} />
        {overview.data && !devices.length && <ConnectPrompt />}
        {devices.length > 0 && (
          <>
            <ChangesCard changes={found.data?.changes} />
            <RoomsCard
              items={rooms}
              usage={roomUse}
              before={(id) => (roomsBefore ? (roomsBefore.devices.find((u) => u.id === id)?.total ?? 0) : undefined)}
              colors={colors}
              rangeLabel={rangeWords}
            />
            <GoalsCard standbyW={found.data?.standby.home_w} />
            <StandbyCard standby={found.data?.standby} devices={devices} colors={colors} />
            <HabitsCard unexplained={found.data?.unexplained} />
            <div className="col-span-12 flex flex-wrap items-center justify-between gap-3 pt-2">
              <h2>{view === "rooms" && hasRooms ? "Rooms and devices" : "Devices"}</h2>
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
          </>
        )}
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
              color={colors.get(item.id)!}
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
              color={colors.get(item.id)!}
              home={usage.data?.total.home ?? null}
              rangeLabel={rangeWords}
              beforeLabel={BEFORE_WORDS[range]}
              best={found.data?.best_times.find((b) => b.id === item.id)}
              saving={found.data?.savings.find((x) => x.id === item.id)}
            />
          ),
        )}
      </div>
    </>
  );
}
