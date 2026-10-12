import { AmberPricesCard } from "~/features/amber/components/AmberPricesCard";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Quiet, WidgetCard } from "~/features/common/widgets/parts";
import type { WidgetDef, WidgetProps } from "~/features/common/widgets/types";

/** Amber's prices card (the Overview's, on Amber), as a widget. */
export const widgets: WidgetDef[] = [
  {
    type: "amber-prices",
    name: "Amber prices",
    sub: "The next 24 hours of prices, and when's cheapest",
    group: "money",
    icon: "dollar",
    thumb: { kind: "bars", color: COLOR.import },
    sizes: { min: [6, 4], max: [12, 7], default: [12, 5] },
    phone: { min: [4, 5], max: [4, 8], default: [4, 6] },
    needs: (ctx) => (ctx.amber ? null : "For Amber Electric's prices"),
    Component: ({ ctx }: WidgetProps) =>
      ctx.prices ? (
        <AmberPricesCard prices={ctx.prices} now={ctx.now} />
      ) : (
        <WidgetCard title="Amber prices" icon="dollar">
          <Quiet>Waiting for Amber's prices.</Quiet>
        </WidgetCard>
      ),
  },
];
