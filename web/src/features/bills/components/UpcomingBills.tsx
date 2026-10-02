import type { Bills } from "~/features/bills/types";
import { basisNote, billAmount, billSpread, spanLabel } from "~/features/bills/utils";
import { StatGrid } from "~/features/bills/components/BillParts";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { DASH, dollars, kWhInt } from "~/features/common/formatting/utils/number";

/** The next few bills, estimated, and the year ahead. */
export function UpcomingBills({ bills }: { bills: Bills | undefined }) {
  const up = bills?.upcoming ?? [];
  const known = up.filter((u) => u !== null);
  const bases = new Set(known.map((u) => u.basis));
  const ny = bills?.next_year;
  return (
    <Card aria-labelledby="h-upcoming">
      <TitleBlock
        id="h-upcoming"
        title="Upcoming bills"
        sub={
          !bills
            ? "Loading"
            : known.length
              ? basisNote(bases.size === 1 ? [...bases][0] : "mixed")
              : "Estimates start once there's a full day of readings"
        }
      />
      <div>
        {up.map((u, i) =>
          u ? (
            <div
              key={u.start}
              className="flex items-center justify-between gap-4 border-b border-line-subtle py-3.5 tabular-nums"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[15px] font-semibold text-ink">{spanLabel(u)}</span>
                <span className="text-xs text-ink-faint">
                  {kWhInt(u.import_kwh)} from the grid · {kWhInt(u.export_kwh)} sent to the grid
                </span>
              </div>
              <div className="flex flex-none flex-col items-end gap-0.5">
                <span className={`text-lg font-semibold ${u.net_cost < 0 ? "text-good" : "text-ink"}`}>
                  {billAmount(u.net_cost)}
                </span>
                <span className="text-xs whitespace-nowrap text-ink-faint">
                  {dollars(u.net_cost - billSpread(u.net_cost))} to {dollars(u.net_cost + billSpread(u.net_cost))}
                </span>
              </div>
            </div>
          ) : (
            <div key={i} className="border-b border-line-subtle py-3.5 text-sm text-ink-faint">
              Not enough history to estimate this bill yet
            </div>
          ),
        )}
      </div>
      <StatGrid
        className="mt-auto"
        stats={[
          { label: "Next 12 months", value: ny ? billAmount(ny.net_cost) : DASH },
          {
            label: "Saved by solar and battery",
            value: ny ? dollars(ny.without_solar - ny.net_cost) : DASH,
            color: "#3ee08f",
          },
        ]}
      />
    </Card>
  );
}
