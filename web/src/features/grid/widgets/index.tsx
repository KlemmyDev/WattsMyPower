import { useQuery } from "@tanstack/react-query";
import { cn } from "~/features/common/ui/utils";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Icon } from "~/features/common/ui/components/Icon";
import { Quiet, WidgetCard } from "~/features/common/widgets/parts";
import type { WidgetDef, WidgetProps } from "~/features/common/widgets/types";
import { gridQuery } from "~/features/grid/api";
import { useGridConnection } from "~/features/grid/components/GridConnection";
import { GridOverviewCard } from "~/features/grid/components/GridOverviewCard";
import { GridHero } from "~/features/grid/components/GridHero";
import { MarketCard, NoticesCard, QualityCard } from "~/features/grid/components/GridMore";
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
function Status({ ctx, h }: WidgetProps) {
  const { data } = useQuery(gridQuery);
  const { offGrid } = useGridConnection();
  const quiet =
    !offGrid &&
    data &&
    data.outlook.level === "normal" &&
    !(data.outages?.now.some((o) => !o.planned) || data.outages?.planned.some((o) => o.affects));
  if (!quiet) return <GridOverviewCard now={ctx.now} slim={h < 2} />;
  return (
    <WidgetCard className={cn("flex-row items-center gap-3", h < 2 ? "py-2.5" : "py-4")}>
      <span className="flex size-10 flex-none items-center justify-center rounded-[13px] bg-fg/6 text-ink-muted">
        <Icon name="grid" size={18} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[15px] font-semibold">The grid's running normally</span>
        <span className="truncate text-[13px] text-ink-muted">
          {offGrid === false ? "On the grid. " : ""}No outages or warnings near you
        </span>
      </span>
    </WidgetCard>
  );
}
/** The Grid page's top card: with the day's chart (Grid today) or without it (Grid at a glance). */
function Hero({ ctx, chart }: WidgetProps & { chart: boolean }) {
  const { data } = useQuery(gridQuery);
  const { start, series } = useGridDay(ctx.now);
  return <GridHero grid={data} p={ctx.p} s={ctx.s} series={series} start={start} now={ctx.now} chart={chart} />;
}
function Wholesale({ ctx }: WidgetProps) {
  const { data } = useQuery(gridQuery);
  return data ? <MarketCard grid={data} now={ctx.now} notices={false} /> : loading("Wholesale market");
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
    sub: "Bought today against a usual day, buying or selling now, sold, the prices and how it's holding up",
    group: "grid",
    icon: "grid",
    thumb: { kind: "number", value: "3.2 kWh", color: COLOR.import },
    sizes: size([6, 3], [12, 4], [12, 3]),
    phone: size([4, 5], [4, 7], [4, 6]),
    Component: (props: WidgetProps) => <Hero {...props} chart={false} />,
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
    sub: "Buying and selling now and through the day, with the rates and the wholesale price under it",
    group: "grid",
    icon: "chart",
    thumb: { kind: "line", color: COLOR.import },
    sizes: size([6, 8], [12, 10], [12, 8]),
    phone: size([4, 10], [4, 13], [4, 11]),
    Component: (props: WidgetProps) => <Hero {...props} chart />,
  },
  {
    type: "grid-wholesale",
    name: "Wholesale market",
    sub: "The market's price now, through today and ahead",
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
