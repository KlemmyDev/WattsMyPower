import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { billsQuery } from "~/features/bills/api";
import { BillHero } from "~/features/bills/components/BillHero";
import { CostByRate } from "~/features/bills/components/Breakdown";
import { PastBills } from "~/features/bills/components/PastBills";
import { Payback } from "~/features/bills/components/Payback";
import { WaysToSave } from "~/features/bills/components/WaysToSave";
import type { Bills } from "~/features/bills/types";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Quiet, WidgetCard } from "~/features/common/widgets/parts";
import type { WidgetDef, WidgetProps } from "~/features/common/widgets/types";

const size = (min: [number, number], max: [number, number], d: [number, number]) => ({ min, max, default: d });

/** The Bills page's top card: with every day of the bill (This bill) or without it (This bill at a glance). */
function Hero({ ctx, chart }: WidgetProps & { chart: boolean }) {
  const { data, isError } = useQuery(billsQuery);
  return <BillHero bills={data} failed={isError} tariff={ctx.s?.tariff} p={ctx.p} now={ctx.now} chart={chart} />;
}

/** A card that needs the bills, quiet until they've loaded. */
function WithBills({ title, children }: { title: string; children: (bills: Bills) => ReactNode }) {
  const { data } = useQuery(billsQuery);
  return data ? (
    children(data)
  ) : (
    <WidgetCard title={title} icon="dollar">
      <Quiet>Loading your bills…</Quiet>
    </WidgetCard>
  );
}

/** The Bills page's cards, as widgets. */
export const widgets: WidgetDef[] = [
  {
    type: "bill-summary",
    name: "This bill at a glance",
    sub: "The bill so far and where it's heading, what the house costs now, and what makes it up",
    group: "money",
    icon: "dollar",
    thumb: { kind: "number", value: "$212", color: COLOR.good },
    sizes: size([6, 3], [12, 4], [12, 3]),
    phone: size([4, 5], [4, 7], [4, 6]),
    Component: (props: WidgetProps) => <Hero {...props} chart={false} />,
  },
  {
    type: "bill-period",
    name: "This bill",
    sub: "The bill so far and now, with every day of it",
    group: "money",
    icon: "chart",
    thumb: { kind: "bars", color: COLOR.good },
    sizes: size([6, 8], [12, 10], [12, 8]),
    phone: size([4, 10], [4, 13], [4, 11]),
    Component: (props: WidgetProps) => <Hero {...props} chart />,
  },
  {
    type: "bills-past",
    name: "Your bills",
    sub: "Past bills, this one and the next few, each opened up",
    group: "money",
    icon: "chart",
    thumb: { kind: "bars", color: COLOR.good },
    sizes: size([6, 4], [12, 6], [7, 5]),
    phone: size([4, 6], [4, 8], [4, 7]),
    Component: () => <WithBills title="Your bills">{(b) => <PastBills bills={b} className="h-full" />}</WithBills>,
  },
  {
    type: "bills-ways",
    name: "Ways to pay less",
    sub: "What to change, and what each is worth a bill",
    group: "money",
    icon: "dollar",
    thumb: { kind: "list", color: COLOR.good },
    sizes: size([4, 4], [8, 8], [5, 5]),
    phone: size([4, 5], [4, 10], [4, 7]),
    Component: ({ ctx }: WidgetProps) => (
      <WithBills title="Ways to pay less">
        {(b) => <WaysToSave bills={b} tariff={ctx.s?.tariff} className="h-full overflow-y-auto" />}
      </WithBills>
    ),
  },
  {
    type: "bills-rates",
    name: "What power costs you",
    sub: "Grid spend this bill by rate, and what each kWh used cost",
    group: "money",
    icon: "dollar",
    thumb: { kind: "split", color: COLOR.import },
    sizes: size([4, 4], [8, 6], [5, 4]),
    phone: size([4, 5], [4, 7], [4, 5]),
    Component: ({ ctx }: WidgetProps) => (
      <WithBills title="What power costs you">
        {(b) => <CostByRate bills={b} tariff={ctx.s?.tariff} className="h-full" />}
      </WithBills>
    ),
  },
  {
    type: "bills-payback",
    name: "Return on your system",
    sub: "What solar and the battery have saved, and when they pay for themselves",
    group: "money",
    icon: "dollar",
    thumb: { kind: "number", value: "$4,210", color: COLOR.good },
    sizes: size([4, 3], [8, 5], [5, 4]),
    phone: size([4, 4], [4, 6], [4, 5]),
    Component: () => <Payback className="h-full" />,
  },
];
