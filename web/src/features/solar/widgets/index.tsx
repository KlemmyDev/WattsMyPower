import { useQuery } from "@tanstack/react-query";
import { COLOR } from "~/features/common/theme/utils/colors";
import { useForecastAccuracy } from "~/features/common/weather/hooks";
import { Quiet, WidgetCard } from "~/features/common/widgets/parts";
import type { WidgetDef, WidgetProps } from "~/features/common/widgets/types";
import { solarInsightsQuery } from "~/features/solar/api";
import { SolarDays } from "~/features/solar/components/SolarDays";
import {
  GENERATING_HOURS,
  generatingRows,
  generatingShow,
  SolarGenerating,
} from "~/features/solar/components/SolarGenerating";
import { SolarPerformance, SolarTrend } from "~/features/solar/components/SolarHealth";
import { SolarHero } from "~/features/solar/components/SolarHero";
import { SolarOutlook } from "~/features/solar/components/SolarOutlook";
import { WhereItWent } from "~/features/solar/components/SolarPage";
import { SolarStrings } from "~/features/solar/components/SolarStrings";
import { useSolarDay } from "~/features/solar/hooks";

const size = (min: [number, number], max: [number, number], d: [number, number]) => ({ min, max, default: d });

/** The Solar page's top card: with the day's chart (Solar today) or without it (Solar at a glance). */
function Hero({ ctx, chart }: WidgetProps & { chart: boolean }) {
  const { start, series, weather } = useSolarDay(ctx.now);
  return (
    <SolarHero
      p={ctx.p}
      s={ctx.s}
      f={ctx.f}
      acc={useForecastAccuracy()}
      series={series}
      weather={weather}
      start={start}
      now={ctx.now}
      chart={chart}
    />
  );
}
function Days({ ctx }: WidgetProps) {
  const { data } = useQuery(solarInsightsQuery);
  return <SolarDays acc={useForecastAccuracy()} performance={data?.performance} now={ctx.now} />;
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
    sub: "Made today and where it's heading, making now, the peak, tomorrow and the sky",
    group: "solar",
    icon: "sun",
    thumb: { kind: "number", value: "18.4 kWh", color: COLOR.solar },
    sizes: size([6, 3], [12, 4], [12, 3]),
    phone: size([4, 5], [4, 7], [4, 6]),
    Component: (props: WidgetProps) => <Hero {...props} chart={false} />,
  },
  {
    type: "solar-generating",
    name: "Generating",
    sub: "What the panels are making now, against the array and the forecast",
    group: "solar",
    icon: "sun",
    thumb: { kind: "number", value: "3.3 kW", color: COLOR.solar },
    sizes: size([2, 2], [8, 6], [3, 3]),
    phone: size([2, 2], [4, 6], [2, 3]),
    rowsFor: (st, _screen, w) => generatingRows(generatingShow(st), w),
    options: [
      {
        key: "array",
        label: "Against the array",
        sub: "A bar of it out of your panels' size",
        kind: "toggle",
        default: true,
        section: "Show",
      },
      {
        key: "expected",
        label: "What was expected now",
        sub: "A tick on the bar, and how far off it is",
        kind: "toggle",
        default: true,
        section: "Show",
      },
      {
        key: "chart",
        label: "Recent hours",
        sub: "As a filled line",
        kind: "toggle",
        default: true,
        section: "Chart",
      },
      {
        key: "hours",
        label: "Going back",
        kind: "select",
        choices: GENERATING_HOURS,
        default: "3",
        section: "Chart",
        when: (st) => st.chart !== false,
      },
      { key: "today", label: "Made today", kind: "toggle", default: true, section: "Figures, given room" },
      { key: "tomorrow", label: "Tomorrow's forecast", kind: "toggle", default: true, section: "Figures, given room" },
    ],
    Component: ({ ctx, settings, w, h }: WidgetProps) => (
      <SolarGenerating p={ctx.p} s={ctx.s} f={ctx.f} now={ctx.now} w={w} h={h} show={generatingShow(settings)} />
    ),
  },
  {
    type: "solar-today",
    name: "Solar today",
    sub: "Making now and through the day, against what the forecast expected",
    group: "solar",
    icon: "chart",
    thumb: { kind: "line", color: COLOR.solar },
    sizes: size([6, 8], [12, 10], [12, 8]),
    phone: size([4, 10], [4, 13], [4, 11]),
    Component: (props: WidgetProps) => <Hero {...props} chart />,
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
    Component: ({ ctx }: WidgetProps) => <SolarStrings p={ctx.p} s={ctx.s} />,
  },
  {
    type: "solar-ahead",
    name: "Outlook",
    sub: "Solar the forecast expects, today and the next two days",
    group: "solar",
    icon: "cloudSun",
    thumb: { kind: "list", color: COLOR.solar },
    sizes: size([4, 3], [8, 5], [5, 4]),
    phone: size([4, 4], [4, 5], [4, 4]),
    Component: ({ ctx }: WidgetProps) => <SolarOutlook f={ctx.f} acc={useForecastAccuracy()} now={ctx.now} />,
  },
  {
    type: "solar-days",
    name: "Solar, last days",
    sub: "Each day made, with the average, best and lowest",
    group: "solar",
    icon: "chart",
    thumb: { kind: "bars", color: COLOR.solar },
    sizes: size([6, 3], [12, 4], [7, 4]),
    phone: size([4, 5], [4, 6], [4, 5]),
    Component: Days,
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
