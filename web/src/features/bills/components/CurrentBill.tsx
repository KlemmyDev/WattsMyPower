import type { Bills } from "~/features/bills/types";
import { billAmount, billCents, spanLabel } from "~/features/bills/utils";
import { Headline } from "~/features/bills/components/Headline";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Card } from "~/features/common/ui/components/Card";
import { DataRow } from "~/features/common/ui/components/DataRow";
import { DASH, dollars, kWhInt, money, plural } from "~/features/common/formatting/utils/number";

/** The bill for the current period: its expected total, how far through it we are, and what makes it up. */
export function CurrentBill({ bills, failed }: { bills: Bills | undefined; failed: boolean }) {
  const exp = bills?.current.expected;
  const soFar = bills?.current.so_far;
  const use = exp ?? soFar;
  const p = bills?.period;
  return (
    <Card aria-labelledby="h-bill">
      <div className="flex items-start justify-between gap-3">
        <Headline
          id="h-bill"
          label={p ? `Current bill · ${spanLabel(p)}` : "Current bill"}
          value={exp ? billAmount(exp.net_cost) : soFar ? billCents(soFar.net_cost) : DASH}
          note={
            !bills
              ? failed
                ? "Bills could not be loaded. Try again shortly."
                : "Loading"
              : exp
                ? `Expected total. Without solar and battery this bill would be about ${dollars(exp.without_solar)}.`
                : "The bill so far. An expected total needs at least one full day of readings."
          }
        />
        <ButtonLink to="/settings/billing" variant="chip" className="flex-none px-3.5 py-1.5">
          Billing period
        </ButtonLink>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="h-1.5 rounded-full bg-track">
          <div
            className="h-full min-w-1.5 rounded-full bg-ink"
            style={{ width: p ? `${((p.day / p.days) * 100).toFixed(1)}%` : 0 }}
          />
        </div>
        <div className="flex justify-between gap-3 text-xs text-ink-faint tabular-nums">
          <span>{p ? `Day ${p.day} of ${p.days}` : ""}</span>
          <span>{soFar ? `${money(soFar.net_cost)} so far` : ""}</span>
        </div>
      </div>
      {use && p && (
        <div>
          <DataRow label={`Grid usage · ${kWhInt(use.import_kwh)}`}>{money(use.import_cost)}</DataRow>
          <DataRow label={`Supply charge · ${exp ? p.days : soFar!.days} ${plural(exp ? p.days : soFar!.days, "day")}`}>
            {money(use.supply)}
          </DataRow>
          <DataRow label={`Feed-in credit · ${kWhInt(use.export_kwh)}`}>
            {/* On Amber, a negative feed-in price makes exporting cost money. */}
            {money(use.feed_in_credit ? -use.feed_in_credit : 0)}
          </DataRow>
          <DataRow label={exp ? "Expected total" : "Total so far"} total>
            {exp ? billAmount(use.net_cost) : billCents(use.net_cost)}
          </DataRow>
        </div>
      )}
    </Card>
  );
}
