import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { paybackQuery } from "~/features/bills/api";
import { Corner } from "~/features/bills/components/BillParts";
import { Card, Muted, TitleBlock } from "~/features/common/ui/components/Card";
import { DataRow } from "~/features/common/ui/components/DataRow";
import { longDate, monthYearLong, parseYmd } from "~/features/common/formatting/utils/date";
import { dollars, money } from "~/features/common/formatting/utils/number";

/** What the system has saved so far and a year, and when it pays for itself, from Settings. */
export function Payback({ className }: { className?: string }) {
  const { data: p } = useQuery(paybackQuery);
  if (!p) return null;
  const settings = (
    <Link to="/settings/cost" className="text-link">
      Settings → Cost and warranty
    </Link>
  );
  return (
    <Card aria-labelledby="h-pay" className={className}>
      <div className="flex items-end justify-between gap-4">
        <TitleBlock
          id="h-pay"
          title="Return on your system"
          sub={
            p.saved_total == null
              ? "Against buying it all from the grid"
              : p.saved_before
                ? `Since it was installed · ${money(p.saved_before)} of it estimated from before your readings`
                : `Since ${longDate.format(parseYmd(p.recorded_from ?? ""))}, against the grid alone`
          }
        />
        {p.saved_total != null && <Corner label="Saved" value={dollars(p.saved_total)} />}
      </div>
      {p.saved_total == null ? (
        <Muted>Fills in after a full day of readings.</Muted>
      ) : (
        <>
          {p.cost && p.paid_pct != null && (
            <div className="flex flex-col gap-1.5">
              <div className="h-2 overflow-hidden rounded-full bg-track">
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
                  ? "Already paid off"
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
            <Muted>Add the install date in {settings} to count savings from before your readings start.</Muted>
          )}
        </>
      )}
    </Card>
  );
}
