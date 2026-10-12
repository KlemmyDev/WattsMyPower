import { useQuery } from "@tanstack/react-query";
import { COLOR } from "~/features/common/theme/utils/colors";
import { addDays, midnight } from "~/features/common/time/utils";
import { Quiet, WidgetCard } from "~/features/common/widgets/parts";
import type { Choice, WidgetCtx, WidgetDef, WidgetProps } from "~/features/common/widgets/types";
import { homeInsightsQuery, homePatternsQuery, homeUsageQuery } from "~/features/home/api";
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
import { RunningNowCard } from "~/features/home/components/RunningNowCard";
import { ChangesCard, GoalsCard } from "~/features/home/components/SummaryCards";
import {
  deviceColors,
  givenDeviceColor,
  givenRoomColor,
  groupPattern,
  groupUsage,
  homeItems,
  roomLook,
} from "~/features/home/utils";

const size = (min: [number, number], max: [number, number], d: [number, number]) => ({ min, max, default: d });
const DEVICE = "var(--color-device-3)";

const needsHome = (ctx: WidgetCtx) =>
  ctx.home && !ctx.home.devices.some((d) => !d.hidden) ? "Connect a smart plug or appliance first" : null;
export const roomChoices = (ctx: WidgetCtx): Choice[] =>
  homeItems(ctx.home?.devices ?? [])
    .filter((i) => i.group)
    .map((i) => ({ value: i.group!, label: i.group! }));
export const deviceChoices = (ctx: WidgetCtx): Choice[] =>
  (ctx.home?.devices ?? []).filter((d) => !d.hidden).map((d) => ({ value: String(d.id), label: d.name }));

/** What a room's or device's card shows about today: what each used, its habits, and when best to run it. */
function useToday(ctx: WidgetCtx) {
  const today = midnight(ctx.now);
  const usage = useQuery(homeUsageQuery(today, addDays(today, 1), "hour"));
  const patterns = useQuery(homePatternsQuery);
  const found = useQuery(homeInsightsQuery);
  const devices = ctx.home?.devices ?? [];
  const kinds = new Map((ctx.home?.kinds ?? []).map((k) => [k.id, k]));
  return { usage: usage.data, patterns: patterns.data, found: found.data, devices, kinds };
}

function Room({ ctx, settings }: WidgetProps) {
  const t = useToday(ctx);
  const rooms = ctx.home?.rooms ?? [];
  const name = (settings.room as string) || roomChoices(ctx)[0]?.value;
  const items = homeItems(t.devices);
  const item = items.find((i) => i.group?.toLowerCase() === name?.toLowerCase());
  if (!item)
    return (
      <WidgetCard title="Room" icon="sofa">
        <Quiet>{ctx.home ? "Choose a room in this widget's settings." : "Loading…"}</Quiet>
      </WidgetCard>
    );
  const used = t.usage && groupUsage(t.usage, items);
  return (
    <GroupCard
      name={item.group!}
      members={item.members}
      used={used?.devices.find((u) => u.id === item.id)}
      before={undefined}
      pattern={t.patterns && groupPattern(t.patterns, item)}
      cycles={item.members.every((d) => t.kinds.get(d.kind)?.cycles)}
      kindLabels={new Map([...t.kinds].map(([id, k]) => [id, k.label]))}
      color={deviceColors(t.devices, rooms, { byRoom: true }).get(item.id)!}
      givenColor={givenRoomColor(t.devices, rooms, item.group!)}
      colors={deviceColors(t.devices, rooms)}
      look={roomLook(rooms, item.group)}
      home={t.usage?.total.home ?? null}
      rangeLabel="today"
      beforeLabel=""
    />
  );
}

function Device({ ctx, settings }: WidgetProps) {
  const t = useToday(ctx);
  const rooms = ctx.home?.rooms ?? [];
  const id = Number(settings.device ?? deviceChoices(ctx)[0]?.value);
  const d = t.devices.find((x) => x.id === id);
  if (!d)
    return (
      <WidgetCard title="Device" icon="plug">
        <Quiet>{ctx.home ? "Choose a device in this widget's settings." : "Loading…"}</Quiet>
      </WidgetCard>
    );
  return (
    <DeviceCard
      device={d}
      used={t.usage?.devices.find((u) => u.id === d.id)}
      before={undefined}
      pattern={t.patterns?.find((p) => p.id === d.id)}
      cycles={!!t.kinds.get(d.kind)?.cycles}
      kindLabel={t.kinds.get(d.kind)?.label ?? "Device"}
      color={deviceColors(t.devices, rooms).get(d.id)!}
      givenColor={givenDeviceColor(t.devices, rooms, d.id)}
      home={t.usage?.total.home ?? null}
      rangeLabel="today"
      beforeLabel=""
      best={t.found?.best_times.find((b) => b.id === d.id)}
      saving={t.found?.savings.find((x) => x.id === d.id)}
    />
  );
}

function Summary({ ctx }: WidgetProps) {
  return <HomeNow p={ctx.p} f={ctx.f} series={useHomeToday(ctx.now).series} now={ctx.now} />;
}
function AgainstUsual({ ctx }: WidgetProps) {
  const { today, series } = useHomeToday(ctx.now);
  return <HomeTodayCard series={series} f={ctx.f} start={today} now={ctx.now} />;
}
function Sources({ ctx }: WidgetProps) {
  return <HomeSourcesCard series={useHomeToday(ctx.now).series} p={ctx.p} days={useHomeDays(ctx.now)} />;
}
function Days({ ctx }: WidgetProps) {
  const days = useHomeDays(ctx.now);
  return days.some((d) => !d.partial) ? (
    <HomeDaysCard days={days} />
  ) : (
    <WidgetCard title="Last 30 days" icon="chart">
      <Quiet>This fills in after a day of readings.</Quiet>
    </WidgetCard>
  );
}
function RoomsNow({ ctx }: WidgetProps) {
  const devices = ctx.home?.devices ?? [];
  return (
    <NowCard
      devices={devices}
      colors={deviceColors(devices, ctx.home?.rooms, { byRoom: true })}
      load={ctx.p?.load_power}
    />
  );
}
function AlwaysOn({ ctx }: WidgetProps) {
  const { data } = useQuery(homeInsightsQuery);
  const devices = ctx.home?.devices ?? [];
  return <StandbyCard standby={data?.standby} devices={devices} colors={deviceColors(devices, ctx.home?.rooms)} />;
}
function Habits() {
  const { data } = useQuery(homeInsightsQuery);
  return <HabitsCard unexplained={data?.unexplained} />;
}
function ThisWeek() {
  const { data } = useQuery(homeInsightsQuery);
  return data?.changes.items.length ? (
    <ChangesCard changes={data.changes} />
  ) : (
    <WidgetCard title="This week" icon="chart">
      <Quiet>Nothing's changed much against last week.</Quiet>
    </WidgetCard>
  );
}
function Goals() {
  const { data } = useQuery(homeInsightsQuery);
  return <GoalsCard standbyW={data?.standby.home_w} />;
}

/** The Home page's cards, as widgets. */
export const widgets: WidgetDef[] = [
  {
    type: "home-summary",
    name: "Home at a glance",
    sub: "Using now, today so far, by midnight, the peak and the price",
    group: "home",
    icon: "home",
    thumb: { kind: "number", value: "788 W", color: COLOR.teal },
    sizes: size([6, 2], [12, 3], [12, 2]),
    phone: size([4, 3], [4, 5], [4, 4]),
    Component: Summary,
  },
  {
    type: "rooms-now",
    name: "Right now",
    sub: "What each room is drawing this minute",
    group: "home",
    icon: "home",
    thumb: { kind: "list", color: DEVICE },
    sizes: size([4, 4], [8, 9], [5, 4]),
    phone: size([4, 4], [4, 9], [4, 5]),
    needs: needsHome,
    Component: RoomsNow,
  },
  {
    type: "running-now",
    name: "Running now",
    sub: "Appliances mid-run, and how long is left",
    group: "home",
    icon: "clock",
    thumb: { kind: "tile", color: "var(--color-device-1)" },
    sizes: size([4, 2], [12, 4], [12, 2]),
    phone: size([4, 2], [4, 4], [4, 2]),
    needs: needsHome,
    Component: () => <RunningNowCard quiet />,
  },
  {
    type: "home-vs-usual",
    name: "Today against a usual day",
    sub: "The house's use through the day, with your rates under it",
    group: "home",
    icon: "chart",
    thumb: { kind: "line", color: COLOR.teal },
    sizes: size([6, 4], [12, 7], [7, 5]),
    phone: size([4, 5], [4, 7], [4, 5]),
    Component: AgainstUsual,
  },
  {
    type: "home-sources",
    name: "Where it came from",
    sub: "Today's use by solar, battery and grid",
    group: "home",
    icon: "sun",
    thumb: { kind: "split", color: COLOR.solar },
    sizes: size([4, 3], [8, 5], [5, 3]),
    phone: size([4, 3], [4, 5], [4, 4]),
    Component: Sources,
  },
  {
    type: "home-days",
    name: "Home, last 30 days",
    sub: "Each day's use, by where it came from",
    group: "home",
    icon: "chart",
    thumb: { kind: "bars", color: COLOR.solar },
    sizes: size([6, 3], [12, 6], [7, 4]),
    phone: size([4, 4], [4, 6], [4, 5]),
    Component: Days,
  },
  {
    type: "room",
    name: "A room",
    sub: "One room, live, with its switches",
    group: "home",
    icon: "sofa",
    thumb: { kind: "tile", color: DEVICE },
    sizes: size([4, 4], [8, 7], [4, 5]),
    phone: size([4, 4], [4, 7], [4, 5]),
    options: [
      {
        key: "room",
        label: "Room",
        kind: "select",
        choices: roomChoices,
        default: (ctx) => roomChoices(ctx)[0]?.value ?? "",
      },
    ],
    needs: (ctx) => needsHome(ctx) ?? (ctx.home && !roomChoices(ctx).length ? "Put devices in a room first" : null),
    Component: Room,
  },
  {
    type: "device",
    name: "A device",
    sub: "One device, what it's doing, and its switch",
    group: "home",
    icon: "plug",
    thumb: { kind: "tile", color: "var(--color-device-1)" },
    sizes: size([4, 4], [8, 7], [4, 5]),
    phone: size([4, 4], [4, 7], [4, 5]),
    options: [
      {
        key: "device",
        label: "Device",
        kind: "select",
        choices: deviceChoices,
        default: (ctx) => deviceChoices(ctx)[0]?.value ?? "",
      },
    ],
    needs: needsHome,
    Component: Device,
  },
  {
    type: "always-on",
    name: "Always on",
    sub: "What your home draws every night, and what it costs a year",
    group: "home",
    icon: "moon",
    thumb: { kind: "number", value: "311 W", color: COLOR.ink },
    sizes: size([5, 4], [12, 7], [6, 5]),
    phone: size([4, 5], [4, 8], [4, 6]),
    needs: needsHome,
    Component: AlwaysOn,
  },
  {
    type: "home-habits",
    name: "Habits in everything else",
    sub: "Big loads no device measures that come back each day",
    group: "home",
    icon: "clock",
    thumb: { kind: "list", color: COLOR.ink },
    sizes: size([5, 4], [12, 7], [6, 5]),
    phone: size([4, 5], [4, 8], [4, 6]),
    needs: needsHome,
    Component: Habits,
  },
  {
    type: "home-week",
    name: "This week",
    sub: "What changed against the week before",
    group: "home",
    icon: "chart",
    thumb: { kind: "list", color: COLOR.teal },
    sizes: size([6, 2], [12, 5], [12, 3]),
    phone: size([4, 3], [4, 6], [4, 4]),
    needs: needsHome,
    Component: ThisWeek,
  },
  {
    type: "home-goals",
    name: "Goals",
    sub: "Your bill against its budget, and your always-on use",
    group: "money",
    icon: "dollar",
    thumb: { kind: "split", color: COLOR.good },
    sizes: size([6, 2], [12, 4], [12, 3]),
    phone: size([4, 4], [4, 6], [4, 4]),
    Component: Goals,
  },
];
