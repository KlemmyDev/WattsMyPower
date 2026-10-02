import { useQuery } from "@tanstack/react-query";
import { billsQuery } from "~/features/bills/api";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { BillsOverTime } from "~/features/bills/components/BillsOverTime";
import { BillPace, CostByTime, CostPerKwh, PaidFor } from "~/features/bills/components/Breakdown";
import { CurrentBill } from "~/features/bills/components/CurrentBill";
import { DailyCost } from "~/features/bills/components/DailyCost";
import { UpcomingBills } from "~/features/bills/components/UpcomingBills";

export function BillsPage() {
  const { data: bills, isError } = useQuery(billsQuery);
  const tariff = useSystem()?.tariff;
  return (
    <>
      <PageHeader title="Bills" sub="Your current bill, what to expect next, and ways to pay less" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-stretch gap-5">
        <CurrentBill bills={bills} failed={isError} />
        <UpcomingBills bills={bills} />
      </div>
      <BillsOverTime bills={bills} />
      {bills && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))] items-stretch gap-5">
          <DailyCost bills={bills} />
          <PaidFor bills={bills} />
          <CostByTime bills={bills} tariff={tariff} />
          <BillPace bills={bills} />
          <CostPerKwh bills={bills} />
        </div>
      )}
    </>
  );
}
