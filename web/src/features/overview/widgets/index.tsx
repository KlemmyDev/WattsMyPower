import { COLOR } from "~/features/common/theme/utils/colors";
import type { Settings, WidgetCtx, WidgetDef, WidgetProps } from "~/features/common/widgets/types";
import { BatteryCard } from "~/features/overview/components/BatteryCard";
import {
  FLOW_OPENS,
  FLOW_READINGS,
  FLOW_STYLES,
  FLOW_UNITS,
  PowerFlowWidget,
} from "~/features/overview/components/PowerFlowStyles";
import { TodayCard } from "~/features/overview/components/TodayCard";
import { TodayEnergyCard } from "~/features/overview/components/TodayEnergyCard";

const size = (min: [number, number], max: [number, number], d: [number, number]) => ({ min, max, default: d });
const scene = (s: Settings) => s.style === "scene" || s.style == null;

/** The Overview's own cards (as it's always been laid out), as widgets. */
export const widgets: WidgetDef[] = [
  {
    type: "power-flow",
    name: "Power flow",
    sub: "Solar, home, grid and battery together, in six styles",
    group: "overview",
    icon: "bolt",
    thumb: { kind: "flow" },
    sizes: size([4, 4], [12, 10], [12, 6]),
    phone: size([4, 4], [4, 8], [4, 5]),
    sizesFor: (s) => (scene(s) ? size([8, 5], [12, 10], [12, 6]) : size([4, 4], [12, 8], [6, 5])),
    options: [
      { key: "style", label: "Style", kind: "style", choices: FLOW_STYLES, default: "scene" },
      ...FLOW_READINGS.map((r) => ({
        key: r.key,
        label: r.label,
        kind: "toggle" as const,
        default: r.key !== "car",
        section: "Readings",
        offered: r.key === "car" ? (ctx: WidgetCtx) => ctx.cars.length > 0 : undefined,
      })),
      {
        key: "rooms",
        label: "Rooms",
        sub: "What each room is drawing",
        kind: "toggle",
        default: true,
        section: "Also show",
        offered: (ctx) => !!ctx.home?.devices.length,
      },
      {
        key: "weather",
        label: "Weather",
        sub: "The sky now and the hours ahead",
        kind: "toggle",
        default: true,
        section: "Also show",
      },
      {
        key: "spark",
        label: "Last two hours",
        sub: "A line behind the figures",
        kind: "toggle",
        default: true,
        section: "Also show",
      },
      { key: "unit", label: "Power in", kind: "select", choices: FLOW_UNITS, default: "auto", section: "Figures" },
      {
        key: "opens",
        label: "Choosing it opens",
        kind: "select",
        choices: FLOW_OPENS,
        default: "each",
        section: "Figures",
      },
    ],
    Component: PowerFlowWidget,
  },
  {
    type: "today-energy",
    name: "Today's energy",
    sub: "Solar, home and battery through the day, against the forecast",
    group: "overview",
    icon: "chart",
    thumb: { kind: "line", color: COLOR.solar },
    sizes: size([8, 7], [12, 10], [12, 8]),
    phone: size([4, 8], [4, 12], [4, 10]),
    Component: ({ ctx }: WidgetProps) => (
      <TodayEnergyCard p={ctx.p} s={ctx.s} f={ctx.f} now={ctx.now} prices={ctx.prices} />
    ),
  },
  {
    type: "today-costs",
    name: "Today so far",
    sub: "What today has cost and saved, rate by rate",
    group: "money",
    icon: "dollar",
    thumb: { kind: "table", color: COLOR.good },
    sizes: size([5, 6], [12, 9], [6, 7]),
    phone: size([4, 7], [4, 10], [4, 8]),
    Component: ({ ctx }: WidgetProps) => <TodayCard tariff={ctx.s?.tariff} now={ctx.now} wide />,
  },
  {
    type: "battery",
    name: "Battery",
    sub: "Its level, status, shortcuts and the last six hours",
    group: "battery",
    icon: "battery",
    thumb: { kind: "ring", color: COLOR.battery },
    sizes: size([5, 6], [12, 9], [6, 7]),
    phone: size([4, 7], [4, 10], [4, 8]),
    needs: (ctx) => (ctx.noBattery ? "Needs a battery" : null),
    Component: ({ ctx }: WidgetProps) => <BatteryCard p={ctx.p} s={ctx.s} f={ctx.f} now={ctx.now} />,
  },
];
