import type { ReactNode } from "react";
import type { PlanComparison } from "~/features/savings/types";
import type { Tariff } from "~/features/common/tariffs/types";
import { Footnote, Muted } from "~/features/common/ui/components/Card";
import { Pill } from "~/features/common/ui/components/Pill";
import { cn } from "~/features/common/ui/utils";
import { dollars } from "~/features/common/formatting/utils/number";
import { tariffDetail } from "~/features/common/tariffs/utils";

/** Each plan's yearly cost on the household's own usage, against the current rates. */
export function PlanResults({ data }: { data: PlanComparison }) {
  const current = data.current.cost.total;
  // The cheapest plan that could be priced exactly (plans arrive cheapest first).
  const best = data.plans.find((p) => !p.notes.length);
  const anyApprox = data.plans.some((p) => p.notes.length);

  const note = !data.plans.length
    ? `${data.brand} has no current plans for ${data.postcode} that can be compared.`
    : best && best.cost.total < current - 1
      ? `Switching to ${best.name} could save about ${dollars(current - best.cost.total)} a year. Estimates only. Check current plan details with ${data.brand} before switching.`
      : data.plans.some((p) => p.notes.length && p.cost.total < current)
        ? `None of the ${data.brand} plans that could be priced exactly cost less than your current rates. Plans marked approximate may cost more than shown.`
        : `Your current rates cost less than the ${data.checked} ${data.brand} plans checked, for how you use power.`;

  return (
    <>
      <div className="flex flex-col">
        <PlanRow
          name={data.current.tariff.source?.plan_name || "Your current rates"}
          tags={
            <Pill tone="inverse" size="sm">
              Your plan
            </Pill>
          }
          tariff={data.current.tariff}
          cost={current}
        />
        {data.plans.map((p) => {
          const cost = p.cost.total;
          return (
            <PlanRow
              key={p.id}
              name={p.name}
              tags={
                <>
                  {p === best && cost < current && (
                    <Pill tone="good" size="sm">
                      Lowest cost
                    </Pill>
                  )}
                  {p.notes.length > 0 && (
                    <Pill tone="neutral" size="sm" className="cursor-help" title={p.notes.join(" ")}>
                      Approximate
                    </Pill>
                  )}
                </>
              }
              tariff={p.tariff}
              cost={cost}
              delta={
                Math.round(cost) === Math.round(current)
                  ? "Same cost"
                  : cost < current
                    ? `Save ${dollars(current - cost)}`
                    : `${dollars(cost - current)} more`
              }
              good={cost < current && !p.notes.length}
            />
          );
        })}
      </div>
      <Muted>{note}</Muted>
      <Footnote>
        {`Based on ${data.profile_days} full days of your readings, scaled to a year. Seasonal plans use the current season's rates.` +
          (data.excluded ? ` ${data.excluded} plans with controlled load or demand charges were left out.` : "") +
          (anyApprox
            ? " Approximate means part of the plan couldn't be priced exactly, for example a feed-in rate that changes through the day."
            : "")}
      </Footnote>
    </>
  );
}

function PlanRow({
  name,
  tags,
  tariff,
  cost,
  delta,
  good,
}: {
  name: string;
  tags: ReactNode;
  tariff: Tariff;
  cost: number;
  delta?: string;
  good?: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(200px,1.4fr)_minmax(220px,2fr)_minmax(100px,0.6fr)_minmax(110px,0.6fr)] items-center gap-5 border-b border-line-subtle py-4 tabular-nums max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-4 max-md:gap-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-[15px] font-semibold">{name}</span>
        {tags}
      </div>
      <span className="text-[13px] text-ink-muted max-md:col-span-full max-md:row-start-2">{tariffDetail(tariff)}</span>
      <span className="text-right text-base font-semibold">{dollars(cost)}</span>
      <span
        className={cn(
          "text-right text-[13px] font-semibold max-md:col-start-2 max-md:row-start-3",
          good ? "text-good" : "text-ink-faint",
        )}
      >
        {delta}
      </span>
    </div>
  );
}
