import { useQuery } from "@tanstack/react-query";
import { AllBatteries, roomBatteries } from "~/features/battery/components/AllBatteries";
import { BatteryActivity } from "~/features/battery/components/BatteryActivity";
import { BatteryHealth } from "~/features/battery/components/BatteryHealth";
import { BatteryModes } from "~/features/battery/components/BatteryModes";
import { BatteryBackup, BatteryDays, BatteryReadings, BatteryToday } from "~/features/battery/components/BatteryMore";
import { BatteryHero } from "~/features/battery/components/BatteryHero";
import { BatterySize } from "~/features/battery/components/BatterySize";
import { useBatteryDay, useBatteryInsights, useBatteryMode, useBatteryView } from "~/features/battery/hooks";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Quiet, WidgetCard } from "~/features/common/widgets/parts";
import type { WidgetCtx, WidgetDef, WidgetProps } from "~/features/common/widgets/types";
import { homeQuery } from "~/features/home/api";

const size = (min: [number, number], max: [number, number], d: [number, number]) => ({ min, max, default: d });
const needsBattery = (ctx: WidgetCtx) => (ctx.noBattery ? "Needs a battery" : null);
const waiting = (name: string) => (
  <WidgetCard title={name} icon="battery">
    <Quiet>Loading…</Quiet>
  </WidgetCard>
);

/** The Battery page's top card: with the day's chart (Battery today) or without it (Battery at a glance). */
function Hero({ ctx, chart }: WidgetProps & { chart: boolean }) {
  const { series } = useBatteryDay(ctx.now);
  return (
    <BatteryHero
      v={useBatteryView()}
      p={ctx.p}
      s={ctx.s}
      mode={useBatteryMode()}
      series={series}
      now={ctx.now}
      chart={chart}
    />
  );
}
function InOut({ ctx }: WidgetProps) {
  return <BatteryToday series={useBatteryDay(ctx.now).series} p={ctx.p} s={ctx.s} />;
}
function Control({ ctx }: WidgetProps) {
  const v = useBatteryView();
  return v ? (
    <BatteryModes v={v} soc={ctx.p?.battery_soc ?? null} now={ctx.now} onPreview={() => {}} onDraft={() => {}} />
  ) : (
    waiting("Control")
  );
}
function Backup({ ctx }: WidgetProps) {
  return <BatteryBackup p={ctx.p} s={ctx.s} f={ctx.f} now={ctx.now} />;
}
function Activity({ ctx }: WidgetProps) {
  return <BatteryActivity now={ctx.now} />;
}
function Readings({ ctx }: WidgetProps) {
  const { start, series } = useBatteryDay(ctx.now);
  return <BatteryReadings series={series} p={ctx.p} s={ctx.s} start={start} now={ctx.now} />;
}
function Health({ ctx }: WidgetProps) {
  const { data } = useBatteryInsights();
  return data ? <BatteryHealth insights={data} system={ctx.s} /> : waiting("Battery health");
}
function Days({ ctx }: WidgetProps) {
  return <BatteryDays s={ctx.s} now={ctx.now} />;
}
function Size() {
  const { data } = useBatteryInsights();
  return data ? <BatterySize sizing={data.sizing} /> : waiting("Is the battery the right size?");
}
function Rooms({ ctx }: WidgetProps) {
  const { data } = useQuery(homeQuery);
  return <AllBatteries p={ctx.p} s={ctx.s} devices={roomBatteries(data?.devices)} />;
}

/** The Battery page's cards, as widgets. */
export const widgets: WidgetDef[] = [
  {
    type: "battery-summary",
    name: "Battery at a glance",
    sub: "Its level and what it's set to do, in or out now, today's charge and discharge, and the price",
    group: "battery",
    icon: "battery",
    thumb: { kind: "number", value: "57%", color: COLOR.battery },
    sizes: size([6, 3], [12, 4], [12, 3]),
    phone: size([4, 5], [4, 7], [4, 6]),
    needs: needsBattery,
    Component: (props: WidgetProps) => <Hero {...props} chart={false} />,
  },
  {
    type: "battery-day",
    name: "Battery today",
    sub: "Its level and now, through the day and tomorrow, with each hour in and out and your rates",
    group: "battery",
    icon: "chart",
    thumb: { kind: "line", color: COLOR.battery },
    sizes: size([6, 9], [12, 12], [12, 10]),
    phone: size([4, 11], [4, 14], [4, 12]),
    needs: needsBattery,
    Component: (props: WidgetProps) => <Hero {...props} chart />,
  },
  {
    type: "battery-control",
    name: "Battery control",
    sub: "Standby, keep a reserve, or charge from the grid",
    group: "battery",
    icon: "settings",
    thumb: { kind: "tile", color: COLOR.battery },
    sizes: size([4, 3], [8, 6], [5, 3]),
    phone: size([4, 3], [4, 6], [4, 4]),
    needs: needsBattery,
    Component: Control,
  },
  {
    type: "battery-in-out",
    name: "In and out today",
    sub: "Where today's charge came from, and what it powered",
    group: "battery",
    icon: "battery",
    thumb: { kind: "split", color: COLOR.battery },
    sizes: size([5, 3], [12, 5], [7, 4]),
    phone: size([4, 4], [4, 6], [4, 4]),
    needs: needsBattery,
    Component: InOut,
  },
  {
    type: "battery-backup",
    name: "If the grid went down",
    sub: "How long the battery would keep the house going",
    group: "battery",
    icon: "shield",
    thumb: { kind: "number", value: "9 h", color: COLOR.battery },
    sizes: size([4, 3], [8, 5], [5, 3]),
    phone: size([4, 3], [4, 5], [4, 4]),
    needs: needsBattery,
    Component: Backup,
  },
  {
    type: "battery-activity",
    name: "Battery activity",
    sub: "What it was set to do, and when",
    group: "battery",
    icon: "clock",
    thumb: { kind: "list", color: COLOR.battery },
    sizes: size([4, 3], [8, 8], [5, 4]),
    phone: size([4, 4], [4, 8], [4, 5]),
    needs: needsBattery,
    Component: Activity,
  },
  {
    type: "battery-readings",
    name: "Battery readings",
    sub: "Its temperature, voltage and power today",
    group: "battery",
    icon: "pulse",
    thumb: { kind: "line", color: COLOR.teal },
    sizes: size([4, 4], [8, 7], [5, 5]),
    phone: size([4, 5], [4, 7], [4, 5]),
    needs: needsBattery,
    Component: Readings,
  },
  {
    type: "battery-health",
    name: "Battery health",
    sub: "How it's holding up, and its cycles",
    group: "battery",
    icon: "battery",
    thumb: { kind: "ring", color: COLOR.good },
    sizes: size([6, 6], [12, 10], [7, 8]),
    phone: size([4, 8], [4, 12], [4, 9]),
    needs: needsBattery,
    Component: Health,
  },
  {
    type: "battery-days",
    name: "Battery, last 30 days",
    sub: "Each day by how much it cycled, with what went in and out",
    group: "battery",
    icon: "chart",
    thumb: { kind: "bars", color: COLOR.battery },
    sizes: size([5, 3], [12, 5], [7, 4]),
    phone: size([4, 4], [4, 6], [4, 4]),
    needs: needsBattery,
    Component: Days,
  },
  {
    type: "battery-size",
    name: "Is it the right size?",
    sub: "Whether a bigger or smaller battery would suit the house",
    group: "battery",
    icon: "battery",
    thumb: { kind: "table", color: COLOR.battery },
    sizes: size([4, 5], [8, 9], [5, 7]),
    phone: size([4, 6], [4, 9], [4, 7]),
    needs: needsBattery,
    Component: Size,
  },
  {
    type: "room-batteries",
    name: "All batteries",
    sub: "The house battery and portable ones in rooms together",
    group: "battery",
    icon: "battery",
    thumb: { kind: "list", color: COLOR.battery },
    sizes: size([6, 2], [12, 5], [12, 3]),
    phone: size([4, 3], [4, 6], [4, 4]),
    needs: (ctx) => (roomBatteries(ctx.home?.devices).length ? null : "Connect a portable battery first"),
    Component: Rooms,
  },
];
