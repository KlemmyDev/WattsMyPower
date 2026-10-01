import { useQuery } from "@tanstack/react-query";
import { savingsQuery } from "~/features/savings/api";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { BillCard } from "~/features/savings/components/BillCard";
import { EvCostCard } from "~/features/savings/components/EvCostCard";
import { PaybackCard } from "~/features/savings/components/PaybackCard";
import { PlanCompareCard } from "~/features/savings/components/PlanCompareCard";

export function SavingsPage() {
  const { data: savings, isError } = useQuery(savingsQuery);
  return (
    <>
      <PageHeader title="Savings" sub="Your bill, system payback, and cheaper ways to power the home and car" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-start gap-5">
        <BillCard bill={savings?.bill} failed={isError} />
        <PaybackCard payback={savings?.payback} />
      </div>
      <PlanCompareCard savings={savings} />
      <EvCostCard />
    </>
  );
}
