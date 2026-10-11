import type { Insights } from "~/features/battery/types/insights";
import { Card, Muted, TitleBlock } from "~/features/common/ui/components/Card";
import { DataRow } from "~/features/common/ui/components/DataRow";
import { dollars, kWh, money, plural } from "~/features/common/formatting/utils/number";

function verdict(s: NonNullable<Insights["sizing"]>): string {
  const full = s.full_by_noon / s.days;
  const low = s.reserve_days / s.days;
  if (full >= 0.5 && low >= 0.5)
    return "Often full by midday and down to its reserve by night. More storage would get used.";
  if (full >= 0.5) return "Often full by midday but rarely runs down. It's big enough for your evenings.";
  if (low >= 0.5)
    return "Often down to its reserve but rarely full by midday. More panels would help more than more storage.";
  return "Rarely full early and rarely runs down. It's a good fit for your system.";
}

/** Whether the battery's size suits the house, and what more storage would have saved over the last 90 days. */
export function BatterySize({ sizing: s, className }: { sizing: Insights["sizing"]; className?: string }) {
  return (
    <Card aria-labelledby="h-bs" className={className}>
      <TitleBlock
        id="h-bs"
        title="Is the battery the right size?"
        sub={s ? `From the last ${s.days} ${plural(s.days, "day")} of readings` : "From the last 90 days of readings"}
      />
      {!s ? (
        <Muted>Needs two weeks of full days of readings.</Muted>
      ) : (
        <>
          <div className="text-[15px] leading-[22px] font-medium text-pretty text-ink">{verdict(s)}</div>
          <div>
            <DataRow label="Full by midday">
              {s.full_by_noon} of {s.days} days
            </DataRow>
            <DataRow label="Down to its reserve">
              {s.reserve_days} of {s.days} days
            </DataRow>
            <DataRow label="Solar sent to the grid while it was full">{kWh(s.sent_while_full_kwh)}</DataRow>
            <DataRow label="Bought from the grid while it was at its reserve">{kWh(s.bought_while_low_kwh)}</DataRow>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold">With more storage on top of your {s.capacity_kwh} kWh</span>
            {s.options.map((o) => (
              <DataRow key={o.extra_kwh} label={`${o.extra_kwh} kWh more`}>
                {o.saved == null
                  ? `${kWh(o.kwh)} moved to the evening`
                  : `${money(o.saved)} saved (${kWh(o.kwh)}), about ${dollars(o.per_year)} a year`}
              </DataRow>
            ))}
            <Muted>
              Worked out by replaying your readings with the extra storage. It keeps solar you sent to the grid and uses
              it when you'd have bought power, at your rates, losing about 10% on the way. Compare the yearly saving
              with a quote for more storage.
            </Muted>
          </div>
        </>
      )}
    </Card>
  );
}
