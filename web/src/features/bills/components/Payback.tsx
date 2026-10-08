import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { paybackQuery } from "~/features/bills/api";
import { BigNumber, Card, Muted, TitleBlock } from "~/features/common/ui/components/Card";
import { DataRow } from "~/features/common/ui/components/DataRow";
import { longDate, monthYearLong, parseYmd } from "~/features/common/formatting/utils/date";
import { dollars, money } from "~/features/common/formatting/utils/number";

/** What the system has saved so far and a year, and when it pays for itself, from Manage → System. */
export function Payback() {
  const { data: p } = useQuery(paybackQuery);
  if (!p) return null;
  const settings = (
    <Link to="/system" className="text-link">
      Manage → System
    </Link>
  );
  return (
    <Card aria-labelledby="h-pay">
      <TitleBlock
        id="h-pay"
        title="Return on your system"
        sub="What solar and the battery have saved against buying it all from the grid, at your rates"
      />
      {p.saved_total == null ? (
        <Muted>Fills in after a full day of readings.</Muted>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-3">
            <BigNumber>{dollars(p.saved_total)}</BigNumber>
            <Muted>
              saved
              {p.saved_before
                ? ` since it was installed (${money(p.saved_before)} of it estimated, from before your readings start)`
                : ` since ${longDate.format(parseYmd(p.recorded_from ?? ""))}`}
            </Muted>
          </div>
          {p.cost && p.paid_pct != null && (
            <div className="flex flex-col gap-1.5">
              <div className="h-2.5 overflow-hidden rounded-full bg-track">
                <div
                  className="h-full origin-left animate-fill-x rounded-full bg-good"
                  style={{ width: `${p.paid_pct}%` }}
                />
              </div>
              <div className="flex justify-between gap-3 text-xs text-ink-faint tabular-nums">
                <span>{Math.round(p.paid_pct)}% paid back</span>
                <span>{dollars(p.cost)} system</span>
              </div>
            </div>
          )}
          <div>
            <DataRow label="Saving a year" muted={p.per_year == null}>
              {p.per_year == null ? "Needs 30 days of readings" : `about ${dollars(p.per_year)}`}
            </DataRow>
            {p.cost ? (
              <DataRow label="Pays for itself">
                {p.paid_off
                  ? "Already has"
                  : p.payback_at
                    ? `around ${monthYearLong.format(new Date(p.payback_at * 1000))}${p.payback_years ? `, ${p.payback_years} years in` : ""}`
                    : "Needs 30 days of readings"}
              </DataRow>
            ) : null}
            {p.co2_t != null && (
              <DataRow label="CO₂ avoided since it was installed">{p.co2_t.toLocaleString("en-AU")} t</DataRow>
            )}
          </div>
          {!p.cost && <Muted>Add what the system cost in {settings} to see when it pays for itself.</Muted>}
          {p.cost && !p.installed && (
            <Muted>Add when it was installed in {settings} to count the savings from before your readings start.</Muted>
          )}
        </>
      )}
    </Card>
  );
}
