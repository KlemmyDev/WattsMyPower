import { COLOR } from "~/features/common/theme/utils/colors";
import { Quiet, WidgetCard } from "~/features/common/widgets/parts";
import type { WidgetDef, WidgetProps } from "~/features/common/widgets/types";
import { BestTimesCard } from "~/features/plan/components/BestTimes";
import { DaysAhead } from "~/features/plan/components/DaysAhead";
import { PlanHero } from "~/features/plan/components/PlanHero";
import { defaultDay, usePlan, type Plan } from "~/features/plan/hooks";

const size = (min: [number, number], max: [number, number], d: [number, number]) => ({ min, max, default: d });

/** Until the forecast's in: why there's nothing yet, in the widget's own card. */
function Waiting({ title, plan }: { title: string; plan: Plan }) {
  return (
    <WidgetCard title={title}>
      <Quiet>{plan.forecast === null ? "The forecast isn't on, or can't be reached." : "Reading the forecast…"}</Quiet>
    </WidgetCard>
  );
}

/** The Plan page's top card for the day it opens on: with the day's chart (Plan ahead) or without it (at a glance). */
function Hero({ ctx, chart }: WidgetProps & { chart: boolean }) {
  const plan = usePlan(ctx.now);
  const day = plan.days[defaultDay(plan.days)];
  if (!day) return <Waiting title="Plan" plan={plan} />;
  return <PlanHero key={day.key} plan={plan} day={day} now={ctx.now} chart={chart} />;
}

function Days({ ctx }: WidgetProps) {
  const plan = usePlan(ctx.now);
  if (!plan.days.length) return <Waiting title="Days ahead" plan={plan} />;
  return <DaysAhead days={plan.days} system={plan.system} now={ctx.now} className="h-full" />;
}

function Best({ ctx }: WidgetProps) {
  const plan = usePlan(ctx.now);
  const day = plan.days[defaultDay(plan.days)];
  if (!day) return <Waiting title="Best times to use power" plan={plan} />;
  return <BestTimesCard plan={plan} day={day} now={ctx.now} className="h-full overflow-hidden" />;
}

/** The Plan page's cards, as widgets. */
export const widgets: WidgetDef[] = [
  {
    type: "plan-summary",
    name: "Plan at a glance",
    sub: "Solar expected today or tomorrow, the next best time to use power, home use, battery, grid and cost",
    group: "weather",
    icon: "cloudSun",
    thumb: { kind: "number", value: "26 kWh", color: COLOR.export },
    sizes: size([6, 3], [12, 4], [12, 3]),
    phone: size([4, 5], [4, 7], [4, 6]),
    Component: (props: WidgetProps) => <Hero {...props} chart={false} />,
  },
  {
    type: "plan-ahead",
    name: "Plan ahead",
    sub: "Today or tomorrow hour by hour: solar, home use, battery and grid, with the best times marked",
    group: "weather",
    icon: "chart",
    thumb: { kind: "line", color: COLOR.export },
    sizes: size([6, 8], [12, 10], [12, 8]),
    phone: size([4, 10], [4, 13], [4, 11]),
    Component: (props: WidgetProps) => <Hero {...props} chart />,
  },
  {
    type: "plan-days",
    name: "Days ahead",
    sub: "Today and the next two days: solar, home use, battery, grid and cost",
    group: "weather",
    icon: "calendar",
    thumb: { kind: "table", color: COLOR.export },
    sizes: size([5, 4], [12, 5], [7, 4]),
    phone: size([4, 4], [4, 5], [4, 4]),
    Component: Days,
  },
  {
    type: "plan-best-times",
    name: "Best times to use power",
    sub: "Spare solar to use and grid hours to go easy on, with the day's key moments",
    group: "weather",
    icon: "clock",
    thumb: { kind: "list", color: COLOR.export },
    sizes: size([4, 4], [8, 8], [5, 5]),
    phone: size([4, 4], [4, 8], [4, 5]),
    Component: Best,
  },
];
