import { useQuery } from "@tanstack/react-query";
import { COLOR } from "~/features/common/theme/utils/colors";
import { addDays, midnight } from "~/features/common/time/utils";
import { Quiet, WidgetCard } from "~/features/common/widgets/parts";
import type { Choice, WidgetCtx, WidgetDef, WidgetProps } from "~/features/common/widgets/types";
import { homeInsightsQuery, homePatternsQuery, homeUsageQuery } from "~/features/home/api";
import { DeviceCard } from "~/features/home/components/DeviceCard";
import { HomeHero } from "~/features/home/components/HomeHero";
import { HomeUsing, USING_HOURS, usingRows, usingShow } from "~/features/home/components/HomeUsing";
import { HomeDaysCard, HomeSourcesCard, useHomeDays, useHomeToday } from "~/features/home/components/HomeWhole";
import { HabitsCard, StandbyCard } from "~/features/home/components/InsightCards";
import { RateNow, rateRows, rateShow } from "~/features/home/components/RateNow";
import { ItemTile, RoomsNow } from "~/features/home/components/RoomTiles";
import { RunningNowCard } from "~/features/home/components/RunningNowCard";
import { ChangesCard, GoalsCard } from "~/features/home/components/SummaryCards";
import {
  deviceColors,
  givenDeviceColor,
  groupPattern,
  groupUsage,
  homeItems,
  OTHER_COLOR,
} from "~/features/home/utils";
import { todayLanes } from "~/features/home/utils/today";

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

function Room({ ctx, settings, w, h }: WidgetProps) {
  const today = midnight(ctx.now);
  const usage = useQuery(homeUsageQuery(today, addDays(today, 1), "hour"));
  const patterns = useQuery(homePatternsQuery);
  const devices = ctx.home?.devices ?? [];
  const rooms = ctx.home?.rooms;
  const name = (settings.room as string) || roomChoices(ctx)[0]?.value;
  const items = homeItems(devices);
  const item = items.find((i) => i.group?.toLowerCase() === name?.toLowerCase());
  if (!item)
    return (
      <WidgetCard title="Room" icon="sofa">
        <Quiet>{ctx.home ? "Choose a room in this widget's settings." : "Loading…"}</Quiet>
      </WidgetCard>
    );
  return (
    <ItemTile
      item={item}
      devices={devices}
      rooms={rooms}
      kinds={new Map((ctx.home?.kinds ?? []).map((k) => [k.id, k]))}
      pattern={patterns.data && groupPattern(patterns.data, item)}
      color={deviceColors(devices, rooms, { byRoom: true }).get(item.id) ?? OTHER_COLOR}
      homeW={ctx.p?.load_power ?? null}
      today={usage.data && groupUsage(usage.data, items)}
      now={ctx.now}
      w={w}
      h={h}
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

/** Home's top card: with the day's chart and a lane per room (Home today), or without (Home at a glance). */
function Hero({ ctx, chart }: WidgetProps & { chart: boolean }) {
  const { today, series } = useHomeToday(ctx.now);
  const usage = useQuery({ ...homeUsageQuery(today, addDays(today, 1), "hour"), enabled: chart && !!ctx.home });
  return (
    <HomeHero
      p={ctx.p}
      f={ctx.f}
      series={series}
      start={today}
      now={ctx.now}
      chart={chart}
      lanes={chart ? todayLanes(usage.data, ctx.home?.devices ?? [], ctx.home?.rooms) : []}
    />
  );
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
function Rooms({ ctx }: WidgetProps) {
  return (
    <RoomsNow
      devices={ctx.home?.devices ?? []}
      rooms={ctx.home?.rooms}
      kinds={ctx.home?.kinds}
      load={ctx.p?.load_power}
      now={ctx.now}
      framed
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
    sub: "Used today against a usual day, using now, the peak, the price and the grid's cost",
    group: "home",
    icon: "home",
    thumb: { kind: "number", value: "788 W", color: COLOR.teal },
    sizes: size([6, 3], [12, 4], [12, 3]),
    phone: size([4, 5], [4, 7], [4, 6]),
    Component: (props: WidgetProps) => <Hero {...props} chart={false} />,
  },
  {
    type: "home-using",
    name: "Using now",
    sub: "What the house draws now, where from, and against a usual draw",
    group: "home",
    icon: "home",
    thumb: { kind: "number", value: "2.8 kW", color: COLOR.teal },
    sizes: size([2, 2], [8, 6], [3, 3]),
    phone: size([2, 2], [4, 6], [2, 3]),
    rowsFor: (st, _screen, w) => usingRows(usingShow(st), w),
    options: [
      {
        key: "sources",
        label: "Where it comes from",
        sub: "Solar, the battery and the grid, as a bar",
        kind: "toggle",
        default: true,
        section: "Show",
      },
      {
        key: "usual",
        label: "Against a usual draw",
        sub: "For this hour, from your recent days",
        kind: "toggle",
        default: true,
        section: "Show",
      },
      { key: "chart", label: "Recent hours", sub: "As a filled line", kind: "toggle", default: true, section: "Chart" },
      {
        key: "hours",
        label: "Going back",
        kind: "select",
        choices: USING_HOURS,
        default: "3",
        section: "Chart",
        when: (st) => st.chart !== false,
      },
      { key: "today", label: "Used today", kind: "toggle", default: true, section: "Figures, given room" },
      { key: "price", label: "What power costs now", kind: "toggle", default: true, section: "Figures, given room" },
    ],
    Component: ({ ctx, settings, w, h }: WidgetProps) => (
      <HomeUsing p={ctx.p} f={ctx.f} now={ctx.now} w={w} h={h} show={usingShow(settings)} />
    ),
  },
  {
    type: "rate-now",
    name: "Power costs now",
    sub: "The rate now, when it changes, and the day's rates",
    group: "money",
    icon: "dollar",
    thumb: { kind: "number", value: "45c", color: COLOR.import },
    sizes: size([2, 2], [8, 4], [3, 3]),
    phone: size([2, 2], [4, 4], [2, 2]),
    rowsFor: (st, _screen, w) => rateRows(rateShow(st), w),
    options: [
      { key: "next", label: "When it changes", sub: "And to what", kind: "toggle", default: true, section: "Show" },
      {
        key: "day",
        label: "The day's rates",
        sub: "As steps, now marked",
        kind: "toggle",
        default: true,
        section: "Show",
      },
      {
        key: "range",
        label: "Cheapest and dearest left today",
        kind: "toggle",
        default: true,
        section: "Figures, given room",
      },
    ],
    Component: ({ ctx, settings, w, h }: WidgetProps) => (
      <RateNow now={ctx.now} w={w} h={h} show={rateShow(settings)} />
    ),
  },
  {
    type: "rooms-now",
    name: "Rooms now",
    sub: "Each room lit by what it draws this minute",
    group: "home",
    icon: "home",
    thumb: { kind: "tiles" },
    sizes: size([4, 4], [12, 10], [12, 5]),
    phone: size([4, 5], [4, 14], [4, 9]),
    needs: needsHome,
    Component: Rooms,
  },
  {
    type: "running-now",
    name: "Running now",
    sub: "Appliances mid-run, how far through and how long is left",
    group: "home",
    icon: "clock",
    thumb: { kind: "ring", color: "var(--color-device-2)" },
    sizes: size([4, 2], [12, 5], [12, 2]),
    phone: size([4, 2], [4, 6], [4, 3]),
    needs: needsHome,
    Component: ({ h }: WidgetProps) => <RunningNowCard quiet compact={h <= 2} className="p-5 max-sm:p-4" />,
  },
  {
    type: "home-vs-usual",
    name: "Home today",
    sub: "Used today and now, against a usual day, with your rates and a lane per room",
    group: "home",
    icon: "chart",
    thumb: { kind: "line", color: COLOR.teal },
    sizes: size([6, 8], [12, 14], [12, 9]),
    phone: size([4, 10], [4, 16], [4, 12]),
    Component: (props: WidgetProps) => <Hero {...props} chart />,
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
    sub: "One room, live: what it draws, its day and what's running",
    group: "home",
    icon: "sofa",
    thumb: { kind: "tile", color: DEVICE },
    sizes: size([2, 2], [6, 5], [3, 3]),
    phone: size([2, 2], [4, 5], [2, 3]),
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
