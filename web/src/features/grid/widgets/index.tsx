import { useQuery } from "@tanstack/react-query";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Icon } from "~/features/common/ui/components/Icon";
import { Quiet, WidgetCard } from "~/features/common/widgets/parts";
import type { WidgetDef, WidgetProps } from "~/features/common/widgets/types";
import { gridQuery } from "~/features/grid/api";
import { GridOverviewCard } from "~/features/grid/components/GridOverviewCard";
import {
  GridSummary,
  GridTodayCard,
  NoticesCard,
  QualityCard,
  WholesaleCard,
} from "~/features/grid/components/GridPage";
import { HazardsCard } from "~/features/grid/components/HazardsCard";
import { OutagesCard } from "~/features/grid/components/OutagesCard";
import { useGridDay } from "~/features/grid/hooks";

const size = (min: [number, number], max: [number, number], d: [number, number]) => ({ min, max, default: d });
const loading = (title: string) => (
  <WidgetCard title={title} icon="grid">
    <Quiet>Loading…</Quiet>
  </WidgetCard>
);

/** The grid's outlook as the Overview's banner (outages, warnings, a price spike); while all's normal, a quiet line. */
function Status({ ctx }: WidgetProps) {
  const { data } = useQuery(gridQuery);
  const quiet =
    data &&
    data.outlook.level === "normal" &&
    !(data.outages?.now.some((o) => !o.planned) || data.outages?.planned.some((o) => o.affects));
  if (!quiet) return <GridOverviewCard now={ctx.now} />;
  return (
    <WidgetCard className="flex-row items-center gap-3 py-4">
      <span className="flex size-10 flex-none items-center justify-center rounded-[13px] bg-fg/6 text-ink-muted">
        <Icon name="grid" size={18} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[15px] font-semibold">The grid's running normally</span>
        <span className="truncate text-[13px] text-ink-muted">No outages or warnings near you</span>
      </span>
    </WidgetCard>
  );
}
function Summary({ ctx }: WidgetProps) {
  const { data } = useQuery(gridQuery);
  return <GridSummary grid={data} p={ctx.p} s={ctx.s} now={ctx.now} />;
}
function Today({ ctx }: WidgetProps) {
  const { start, series } = useGridDay(ctx.now);
  return <GridTodayCard series={series} p={ctx.p} start={start} now={ctx.now} />;
}
function Wholesale({ ctx }: WidgetProps) {
  const { data } = useQuery(gridQuery);
  return data ? <WholesaleCard grid={data} now={ctx.now} /> : loading("Wholesale price");
}
function Quality({ ctx }: WidgetProps) {
  const { data } = useQuery(gridQuery);
  const { start, series } = useGridDay(ctx.now);
  return <QualityCard series={series} p={ctx.p} grid={data} start={start} now={ctx.now} />;
}
function Notices() {
  const { data } = useQuery(gridQuery);
  return data ? <NoticesCard grid={data} /> : loading("AEMO notices");
}
function Outages({ ctx }: WidgetProps) {
  const { data } = useQuery(gridQuery);
  const s = ctx.s;
  return data?.outages ? (
    <OutagesCard
      view={data.outages}
      now={ctx.now}
      home={s?.latitude != null && s.longitude != null ? { lat: s.latitude, lon: s.longitude } : null}
    />
  ) : (
    loading("Outages near you")
  );
}
function Warnings({ ctx }: WidgetProps) {
  const { data } = useQuery(gridQuery);
  return data?.hazards ? <HazardsCard view={data.hazards} now={ctx.now} /> : loading("Warnings");
}

/** The Grid page's cards (and the Overview's banner about it), as widgets. */
export const widgets: WidgetDef[] = [
  {
    type: "grid",
    name: "Grid status",
    sub: "Outages, warnings and price spikes near you, in one line",
    group: "grid",
    icon: "grid",
    thumb: { kind: "alert", color: COLOR.warn, value: "All normal" },
    sizes: size([4, 1], [12, 2], [12, 1]),
    phone: size([4, 1], [4, 3], [4, 1]),
    Component: Status,
  },
  {
    type: "grid-summary",
    name: "Grid at a glance",
    sub: "How it's holding up, buying or selling now, and the price",
    group: "grid",
    icon: "grid",
    thumb: { kind: "number", value: "0 W", color: COLOR.import },
    sizes: size([6, 2], [12, 4], [12, 3]),
    phone: size([4, 3], [4, 6], [4, 4]),
    Component: Summary,
  },
  {
    type: "grid-outages",
    name: "Outages near you",
    sub: "Energex and Ergon's, on a map",
    group: "grid",
    icon: "bolt",
    thumb: { kind: "alert", color: COLOR.export, value: "None near" },
    sizes: size([6, 4], [12, 7], [12, 5]),
    phone: size([4, 5], [4, 8], [4, 6]),
    Component: Outages,
  },
  {
    type: "grid-today",
    name: "Grid today",
    sub: "What you bought and sold through the day",
    group: "grid",
    icon: "chart",
    thumb: { kind: "line", color: COLOR.import },
    sizes: size([6, 4], [12, 6], [7, 4]),
    phone: size([4, 4], [4, 6], [4, 5]),
    Component: Today,
  },
  {
    type: "grid-wholesale",
    name: "Wholesale price",
    sub: "The market's price now and ahead",
    group: "money",
    icon: "dollar",
    thumb: { kind: "bars", color: COLOR.import },
    sizes: size([6, 4], [12, 7], [7, 5]),
    phone: size([4, 5], [4, 7], [4, 6]),
    Component: Wholesale,
  },
  {
    type: "grid-warnings",
    name: "Warnings",
    sub: "The Bureau's weather warnings and fire danger for your area",
    group: "grid",
    icon: "shield",
    thumb: { kind: "alert", color: COLOR.warn, value: "None now" },
    sizes: size([4, 2], [12, 5], [5, 3]),
    phone: size([4, 3], [4, 5], [4, 3]),
    Component: Warnings,
  },
  {
    type: "grid-quality",
    name: "Grid quality",
    sub: "Voltage and frequency at your meter today",
    group: "grid",
    icon: "pulse",
    thumb: { kind: "line", color: COLOR.import },
    sizes: size([4, 4], [8, 6], [5, 5]),
    phone: size([4, 5], [4, 6], [4, 5]),
    Component: Quality,
  },
  {
    type: "grid-notices",
    name: "AEMO notices",
    sub: "The market operator's notices for your region",
    group: "grid",
    icon: "bell",
    thumb: { kind: "list", color: COLOR.import },
    sizes: size([4, 2], [8, 5], [5, 2]),
    phone: size([4, 2], [4, 5], [4, 3]),
    Component: Notices,
  },
];
