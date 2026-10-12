import { useQuery } from "@tanstack/react-query";
import { billsQuery } from "~/features/bills/api";
import { BillHero } from "~/features/bills/components/BillHero";
import { CostByRate } from "~/features/bills/components/Breakdown";
import { GridCostHeatmap } from "~/features/bills/components/GridCostHeatmap";
import { PastBills } from "~/features/bills/components/PastBills";
import { Payback } from "~/features/bills/components/Payback";
import { PeriodCalendar } from "~/features/bills/components/PeriodCalendar";
import { WaysToSave } from "~/features/bills/components/WaysToSave";
import { spanLabel } from "~/features/bills/utils";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { useNow } from "~/features/common/time/hooks";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Icon } from "~/features/common/ui/components/Icon";
import { Skeleton } from "~/features/common/ui/components/Skeleton";

/**
 * Bills, as Solar, Home and Battery have their pages: this bill so far and now in one card (where it's heading, what
 * the house is costing now, what makes it up, its pace and every day of it); then every day as a calendar to open one
 * up and when on the clock grid power costs most; beside them ways to pay less, your bills past and ahead, what power
 * costs you by rate, and what the system has saved over its life.
 */
export function BillsPage() {
  const now = useNow(30_000);
  const p = useSnapshot();
  const tariff = useSystem()?.tariff;
  const { data: bills, isError } = useQuery(billsQuery);
  return (
    <>
      <PageHeader
        title="Bills"
        sub={
          bills
            ? `${spanLabel(bills.period)} · day ${bills.period.day} of ${bills.period.days}`
            : "What this bill is costing so far, and how to pay less"
        }
        action={
          // Below xl the row of pills over the page has it.
          <ButtonLink to="/bills/rates" variant="chip" className="flex-none gap-2 px-3.5 py-1.5 max-xl:hidden">
            <Icon name="tag" size={15} />
            Rates & settings
          </ButtonLink>
        }
      />
      <div className="flex flex-col gap-5">
        <BillHero bills={bills} failed={isError} tariff={tariff} p={p} now={now} />
        {bills ? (
          // The deeper story on the left (each day, the hours it comes from); what to do about it and quick facts on
          // the right (the bills past and ahead among them, to balance the columns). Narrower, one column: ways to pay
          // less first.
          <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1">
            <div className="flex min-w-0 flex-col gap-5 max-3xl:contents">
              <PeriodCalendar bills={bills} tariff={tariff} className="max-3xl:order-2" />
              <GridCostHeatmap className="max-3xl:order-5" />
            </div>
            <div className="flex min-w-0 flex-col gap-5 max-3xl:contents">
              <WaysToSave bills={bills} tariff={tariff} className="max-3xl:order-1" />
              <PastBills bills={bills} className="max-3xl:order-3" />
              <CostByRate bills={bills} tariff={tariff} className="max-3xl:order-4" />
              <Payback className="max-3xl:order-6" />
            </div>
          </div>
        ) : (
          !isError && <Skeleton className="h-[480px] rounded-3xl" />
        )}
      </div>
    </>
  );
}
