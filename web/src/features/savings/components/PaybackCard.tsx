import { useState } from "react";
import type { Savings } from "~/features/savings/types";
import { Button } from "~/features/common/ui/components/Button";
import { Card } from "~/features/common/ui/components/Card";
import { DataRow } from "~/features/common/ui/components/DataRow";
import { useNow } from "~/features/common/time/hooks";
import { DASH, dollars, money, plural } from "~/features/common/formatting/utils/number";
import { Headline } from "~/features/savings/components/Headline";
import { summarisePayback } from "~/features/savings/utils";
import { SystemCostForm } from "~/features/savings/components/SystemCostForm";

type Payback = Savings["payback"];

export function PaybackCard({ payback }: { payback: Payback | undefined }) {
  return (
    <Card aria-labelledby="h-pay">
      {payback ? (
        <PaybackFigures payback={payback} />
      ) : (
        <>
          <Headline id="h-pay" label="System payback" value={DASH} note="" />
          <PaybackBar progress={0} />
        </>
      )}
    </Card>
  );
}

function PaybackFigures({ payback }: { payback: Payback }) {
  const now = useNow();
  const [editing, setEditing] = useState(false);
  const { system_cost: cost, saved_lifetime: saved, per_month: perMonth, basis_days: basisDays } = payback;
  const { figure, progress, note, months } = summarisePayback(payback, now);

  return (
    <>
      <Headline id="h-pay" label="System payback" value={figure} note={note} />
      <PaybackBar progress={progress} />
      {/* With no cost entered the form is always open, and there's nothing to cancel back to. */}
      {!cost ? (
        <SystemCostForm initial="" onSaved={() => setEditing(false)} />
      ) : (
        editing && (
          <SystemCostForm
            initial={Math.round(cost).toLocaleString("en-AU")}
            onCancel={() => setEditing(false)}
            onSaved={() => setEditing(false)}
          />
        )
      )}
      <div>
        <DataRow label="System cost" muted={!cost}>
          {cost ? (
            <>
              {dollars(cost)}{" "}
              <Button variant="link" size="sm" className="ml-2" onClick={() => setEditing(true)}>
                Edit
              </Button>
            </>
          ) : (
            "Not entered"
          )}
        </DataRow>
        <DataRow label="Saved since install, at today's rates">{dollars(saved)}</DataRow>
        <DataRow
          label={`Average saving per month${basisDays && basisDays < 30 ? ` · ${basisDays} ${plural(basisDays, "day")} of data` : ""}`}
          muted={perMonth == null}
        >
          {perMonth != null ? money(perMonth) : "Needs a full day of readings"}
        </DataRow>
        <DataRow label="Months to go">{months ?? DASH}</DataRow>
      </div>
    </>
  );
}

function PaybackBar({ progress }: { progress: number }) {
  return (
    <div className="relative h-2.5 rounded-full bg-track">
      <div
        className="h-full rounded-full bg-good transition-[width] duration-320 ease-out-soft"
        style={{ width: `${progress.toFixed(1)}%` }}
      />
    </div>
  );
}
