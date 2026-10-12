import { COLOR } from "~/features/common/theme/utils/colors";
import type { Settings, WidgetCtx, WidgetDef, WidgetProps } from "~/features/common/widgets/types";
import { BATTERY_FACTS, BATTERY_HOURS, BatteryCard, batteryShow } from "~/features/overview/components/BatteryCard";
import {
  FLOW_OPENS,
  FLOW_READINGS,
  FLOW_STYLES,
  FLOW_UNITS,
  PowerFlowWidget,
} from "~/features/overview/components/PowerFlowStyles";
import { TODAY_LEADS, TodayCard, todayShow } from "~/features/overview/components/TodayCard";
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
    sizes: size([2, 2], [12, 9], [6, 7]),
    phone: size([2, 2], [4, 10], [4, 8]),
    options: [
      { key: "lead", label: "First figure", kind: "select", choices: TODAY_LEADS, default: "cost", section: "Figures" },
      {
        key: "subs",
        label: "A line on each",
        sub: "The supply charge, and what you'd pay without solar",
        kind: "toggle",
        default: true,
        section: "Figures",
      },
      {
        key: "split",
        label: "What you pay and what's covered",
        sub: "As a bar",
        kind: "toggle",
        default: true,
        section: "Show",
      },
      { key: "rates", label: "Rate by rate", sub: "Given room", kind: "toggle", default: true, section: "Show" },
      {
        key: "tariff",
        label: "Your kind of rates",
        sub: "Linking to them",
        kind: "toggle",
        default: true,
        section: "Show",
      },
    ],
    Component: ({ ctx, settings, w, h }: WidgetProps) => (
      <TodayCard tariff={ctx.s?.tariff} now={ctx.now} w={w} h={h} show={todayShow(settings)} />
    ),
  },
  {
    type: "battery",
    name: "Battery",
    sub: "Its level, status, shortcuts and the last six hours",
    group: "battery",
    icon: "battery",
    thumb: { kind: "ring", color: COLOR.battery },
    sizes: size([2, 2], [12, 9], [6, 7]),
    phone: size([2, 2], [4, 10], [4, 8]),
    needs: (ctx) => (ctx.noBattery ? "Needs a battery" : null),
    options: [
      {
        key: "outlook",
        label: "Time to full",
        sub: "Or to its reserve, or what it's set to do",
        kind: "toggle",
        default: true,
        section: "Show",
      },
      {
        key: "kwh",
        label: "What it holds",
        sub: "The kWh in the ring",
        kind: "toggle",
        default: true,
        section: "Show",
      },
      {
        key: "mode",
        label: "What it's set to do",
        sub: "Normal, standby, a reserve…",
        kind: "toggle",
        default: true,
        section: "Show",
      },
      {
        key: "shortcuts",
        label: "Shortcuts",
        sub: "Standby, keep a reserve or charge, in one tap",
        kind: "toggle",
        default: true,
        section: "Show",
        when: (s) => s.mode !== false,
      },
      {
        key: "chart",
        label: "Recent hours",
        sub: "Its charge, hour by hour",
        kind: "toggle",
        default: true,
        section: "Chart",
      },
      {
        key: "hours",
        label: "Going back",
        kind: "select",
        choices: BATTERY_HOURS,
        default: "auto",
        section: "Chart",
        when: (s) => s.chart !== false,
      },
      ...BATTERY_FACTS.map((x) => ({
        key: x.key,
        label: x.label,
        sub: "sub" in x ? x.sub : undefined,
        kind: "toggle" as const,
        default: true,
        section: "Figures, given room",
        offered:
          x.key === "health"
            ? (ctx: WidgetCtx) => ctx.p?.battery_soh != null
            : x.key === "temp"
              ? (ctx: WidgetCtx) => ctx.p?.battery_temp != null
              : undefined,
      })),
    ],
    Component: ({ ctx, settings, w, h }: WidgetProps) => (
      <BatteryCard p={ctx.p} s={ctx.s} f={ctx.f} now={ctx.now} w={w} h={h} show={batteryShow(settings)} />
    ),
  },
];
