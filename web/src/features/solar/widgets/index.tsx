import { useQuery } from "@tanstack/react-query";
import { COLOR } from "~/features/common/theme/utils/colors";
import { useForecastAccuracy } from "~/features/common/weather/hooks";
import { Quiet, WidgetCard } from "~/features/common/widgets/parts";
import type { WidgetDef, WidgetProps } from "~/features/common/widgets/types";
import { solarInsightsQuery } from "~/features/solar/api";
import { SolarPerformance, SolarTrend } from "~/features/solar/components/SolarHealth";
import {
  DaysAhead,
  LastDays,
  place,
  SolarNow,
  SolarTodayCard,
  Strings,
  WhereItWent,
} from "~/features/solar/components/SolarPage";
import { useSolarDay } from "~/features/solar/hooks";

const size = (min: [number, number], max: [number, number], d: [number, number]) => ({ min, max, default: d });

function Summary({ ctx }: WidgetProps) {
  const { series } = useSolarDay(ctx.now);
  return <SolarNow p={ctx.p} s={ctx.s} f={ctx.f} acc={useForecastAccuracy()} series={series} now={ctx.now} />;
}
function Today({ ctx }: WidgetProps) {
  const { start, series, weather } = useSolarDay(ctx.now);
  return <SolarTodayCard series={series} f={ctx.f} weather={weather} start={start} now={ctx.now} at={place(ctx.s)} />;
}
function Performance() {
  const { data } = useQuery(solarInsightsQuery);
  return data ? (
    <SolarPerformance performance={data.performance} />
  ) : (
    <WidgetCard title="Performance">
      <Quiet>Loading…</Quiet>
    </WidgetCard>
  );
}
function Trend() {
  const { data } = useQuery(solarInsightsQuery);
  return data?.trend ? (
    <SolarTrend trend={data.trend} />
  ) : (
    <WidgetCard title="Over the year">
      <Quiet>This fills in once there are months to compare.</Quiet>
    </WidgetCard>
  );
}

/** The Solar page's cards, as widgets. */
export const widgets: WidgetDef[] = [
  {
    type: "solar-summary",
    name: "Solar at a glance",
    sub: "Making now, today so far, by midnight, tomorrow and the sky",
    group: "solar",
    icon: "sun",
    thumb: { kind: "number", value: "4.7 kW", color: COLOR.solar },
    sizes: size([6, 2], [12, 3], [12, 2]),
    phone: size([4, 3], [4, 5], [4, 4]),
    Component: Summary,
  },
  {
    type: "solar-today",
    name: "Solar today",
    sub: "Through the day, against what the forecast expected",
    group: "solar",
    icon: "chart",
    thumb: { kind: "line", color: COLOR.solar },
    sizes: size([6, 5], [12, 8], [7, 6]),
    phone: size([4, 5], [4, 8], [4, 6]),
    Component: Today,
  },
  {
    type: "solar-where",
    name: "Where the solar went",
    sub: "Used at home, into the battery, sent to the grid",
    group: "solar",
    icon: "sun",
    thumb: { kind: "split", color: COLOR.solar },
    sizes: size([4, 3], [8, 4], [5, 3]),
    phone: size([4, 3], [4, 4], [4, 3]),
    Component: ({ ctx }: WidgetProps) => <WhereItWent p={ctx.p} />,
  },
  {
    type: "solar-strings",
    name: "Inverters and strings",
    sub: "Each inverter and string of panels now",
    group: "solar",
    icon: "grid",
    thumb: { kind: "list", color: COLOR.solar },
    sizes: size([4, 3], [8, 6], [5, 4]),
    phone: size([4, 4], [4, 6], [4, 4]),
    Component: ({ ctx }: WidgetProps) => <Strings p={ctx.p} s={ctx.s} />,
  },
  {
    type: "solar-ahead",
    name: "Days ahead",
    sub: "The forecast for today and the next two days",
    group: "solar",
    icon: "cloudSun",
    thumb: { kind: "list", color: COLOR.solar },
    sizes: size([4, 3], [8, 5], [5, 4]),
    phone: size([4, 4], [4, 5], [4, 4]),
    Component: ({ ctx }: WidgetProps) => <DaysAhead f={ctx.f} acc={useForecastAccuracy()} now={ctx.now} />,
  },
  {
    type: "solar-days",
    name: "Solar, last days",
    sub: "Each day made, against the forecast",
    group: "solar",
    icon: "chart",
    thumb: { kind: "bars", color: COLOR.solar },
    sizes: size([5, 3], [12, 5], [7, 4]),
    phone: size([4, 4], [4, 5], [4, 4]),
    Component: () => <LastDays acc={useForecastAccuracy()} />,
  },
  {
    type: "solar-performance",
    name: "Performance",
    sub: "What the panels made against what the weather allowed",
    group: "solar",
    icon: "pulse",
    thumb: { kind: "bars", color: COLOR.solarDeep },
    sizes: size([5, 4], [12, 7], [7, 5]),
    phone: size([4, 5], [4, 7], [4, 6]),
    Component: Performance,
  },
  {
    type: "solar-trend",
    name: "Over the year",
    sub: "What the panels make per unit of sunshine, month by month",
    group: "solar",
    icon: "chart",
    thumb: { kind: "bars", color: COLOR.solar },
    sizes: size([4, 3], [8, 6], [5, 4]),
    phone: size([4, 4], [4, 6], [4, 5]),
    Component: Trend,
  },
];
