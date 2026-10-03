import { useQuery } from "@tanstack/react-query";
import { billsQuery } from "~/features/bills/api";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { TitleBlock } from "~/features/common/ui/components/Card";
import { BillsOverTime } from "~/features/bills/components/BillsOverTime";
import { BillPace, CostByTime, CostPerKwh, PaidFor } from "~/features/bills/components/Breakdown";
import { CurrentBill } from "~/features/bills/components/CurrentBill";
import { PeriodCalendar } from "~/features/bills/components/PeriodCalendar";
import { UpcomingBills } from "~/features/bills/components/UpcomingBills";
import { WaysToSave } from "~/features/bills/components/WaysToSave";

/**
 * The current billing period first: the bill and its pace, every day of it as a calendar, and ways
 * to lower it; then where its money went; then the bills ahead and behind.
 */
export function BillsPage() {
  const { data: bills, isError } = useQuery(billsQuery);
  const tariff = useSystem()?.tariff;
  return (
    <>
      <PageHeader
        title="Bills"
        sub="This billing period: what it's costing, which days drove it, and how to pay less"
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-stretch gap-5">
        <CurrentBill bills={bills} failed={isError} />
        {bills && <BillPace bills={bills} />}
      </div>
      {bills && (
        <>
          <PeriodCalendar bills={bills} tariff={tariff} />
          <WaysToSave bills={bills} tariff={tariff} />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))] items-stretch gap-5">
            <PaidFor bills={bills} />
            <CostByTime bills={bills} tariff={tariff} />
            <CostPerKwh bills={bills} />
          </div>
          <TitleBlock
            title="Bills ahead and behind"
            sub="What the next bills are likely to be, and how this one compares with the last year's"
            className="pt-5"
          />
          <UpcomingBills bills={bills} />
          <BillsOverTime bills={bills} />
        </>
      )}
    </>
  );
}
