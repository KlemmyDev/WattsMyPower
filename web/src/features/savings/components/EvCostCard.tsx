import type { Tariff } from "~/features/common/tariffs/types";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Card, Muted, TitleBlock } from "~/features/common/ui/components/Card";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { cn } from "~/features/common/ui/utils";
import { centsShort, money } from "~/features/common/formatting/utils/number";
import { liveBands, tariffNumber } from "~/features/common/tariffs/utils";

// Per 100 km.
const EV_KWH = 16.5;
const PETROL_L = 8;
const PETROL_PRICE = 1.95;

type Row = { label: string; sub: string; cost: number; bar: string };

function costRows(t: Tariff): Row[] {
  const bands = liveBands(t);
  if (!bands.length) return [];
  const cheap = bands.reduce((a, b) => (b.rate < a.rate ? b : a));
  return [
    {
      label: "From solar",
      sub: "Feed-in credit you give up",
      cost: EV_KWH * tariffNumber(t.feed_in_rate),
      bar: "bg-good",
    },
    {
      label: "From the grid",
      sub:
        t.type === "tou"
          ? `${cheap.name} rate, ${centsShort(cheap.rate)} per kWh`
          : `At ${centsShort(cheap.rate)} per kWh`,
      cost: EV_KWH * cheap.rate,
      bar: "bg-grey-500",
    },
    {
      label: "Petrol car",
      sub: `${PETROL_L} L per 100 km at ${money(PETROL_PRICE)} a litre`,
      cost: PETROL_L * PETROL_PRICE,
      bar: "bg-ink",
    },
  ];
}

export function EvCostCard() {
  const tariff = useSystem()?.tariff;
  const rows = tariff ? costRows(tariff) : [];
  const max = Math.max(...rows.map((r) => r.cost));

  return (
    <Card aria-labelledby="h-ev">
      <TitleBlock
        id="h-ev"
        title="Cost to drive 100 km"
        sub={`Tesla Model Y Long Range, about ${EV_KWH} kWh per 100 km including charging losses`}
      />
      <div className="flex flex-col gap-3.5">
        {rows.map((r) => (
          <div
            key={r.label}
            className="grid grid-cols-[minmax(140px,200px)_1fr_80px] items-center gap-4 max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-3 max-md:gap-y-1.5"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{r.label}</span>
              <span className="text-xs text-ink-faint">{r.sub}</span>
            </div>
            <div className="h-3.5 rounded-full bg-popover max-md:col-span-full max-md:row-start-2">
              <div
                className={cn("h-full min-w-3.5 rounded-full", r.bar)}
                style={{ width: `${((r.cost / max) * 100).toFixed(1)}%` }}
              />
            </div>
            <span className="text-right text-base font-semibold tabular-nums">{money(r.cost)}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 rounded-xl border border-line-subtle px-4 py-3.5">
        <Muted className="flex-[1_1_280px]">
          Connect Tesla to see how far you've driven, how much of the charging came from solar, and what you saved
          compared with petrol.
        </Muted>
        <ButtonLink to="/tesla/setup" variant="outline">
          Connect Tesla
        </ButtonLink>
      </div>
    </Card>
  );
}
