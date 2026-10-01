import type { Savings } from "~/features/savings/types";
import { Card } from "~/features/common/ui/components/Card";
import { DataRow } from "~/features/common/ui/components/DataRow";
import { DASH, kWhInt, money, plural } from "~/features/common/formatting/utils/number";
import { dayMonth } from "~/features/common/formatting/utils/date";
import { Headline } from "~/features/savings/components/Headline";

type Bill = Savings["bill"];

/** This quarter's bill: the estimate for the whole quarter once there's a full day of readings, else the bill so far. */
export function BillCard({ bill, failed }: { bill: Bill | undefined; failed: boolean }) {
  return (
    <Card aria-labelledby="h-bill">
      {bill ? (
        <BillFigures bill={bill} />
      ) : (
        <>
          <Headline
            id="h-bill"
            label="Estimated bill"
            value={DASH}
            note={failed ? "Savings could not be loaded. Try again shortly." : "Loading"}
          />
          <QuarterProgress progress={0} />
        </>
      )}
    </Card>
  );
}

function BillFigures({ bill }: { bill: Bill }) {
  const { estimate: est, so_far: soFar } = bill;
  const use = est ?? soFar;
  const supplyDays = est ? bill.days : soFar.days;
  return (
    <>
      <Headline
        id="h-bill"
        label={`${est ? "Estimated bill" : "Bill so far"} · ${dayMonth(bill.start)} to ${dayMonth(bill.end)}`}
        value={money(use.net_cost)}
        note={
          est
            ? `Without solar and the battery it would be about ${money(est.without_solar)}`
            : `The quarter's estimate starts after your first full day of readings. Without solar and the battery, the bill so far would be ${money(soFar.without_solar)}.`
        }
      />
      <QuarterProgress
        progress={(bill.day / bill.days) * 100}
        left={`Day ${bill.day} of ${bill.days}`}
        right={
          est
            ? `Estimated from your last ${bill.basis_days === 1 ? "full day" : `${bill.basis_days} full days`}`
            : "Actual so far"
        }
      />
      <div>
        <DataRow label={`Grid usage · ${kWhInt(use.import_kwh)}`}>{money(use.import_cost)}</DataRow>
        <DataRow label={`Supply charge · ${supplyDays} ${plural(supplyDays, "day")}`}>{money(use.supply)}</DataRow>
        <DataRow label={`Feed-in credit · ${kWhInt(use.export_kwh)}`}>
          {use.feed_in_credit > 0 ? `−${money(use.feed_in_credit)}` : money(0)}
        </DataRow>
        <DataRow label={est ? "Estimated total" : "Total so far"} total>
          {money(use.net_cost)}
        </DataRow>
      </div>
    </>
  );
}

/** How far through the billing quarter we are. */
function QuarterProgress({ progress, left, right }: { progress: number; left?: string; right?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="h-1.5 rounded-full bg-track">
        <div className="h-full min-w-1.5 rounded-full bg-ink" style={{ width: `${progress.toFixed(1)}%` }} />
      </div>
      <div className="flex justify-between gap-3 text-xs text-ink-faint">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}
