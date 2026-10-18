import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { billsQuery, paybackQuery } from "~/features/bills/api";
import { Corner } from "~/features/bills/components/BillParts";
import { useNow } from "~/features/common/time/hooks";
import { Card, Muted, TitleBlock } from "~/features/common/ui/components/Card";
import { DataRow } from "~/features/common/ui/components/DataRow";
import { longDate, monthYearLong, parseYmd } from "~/features/common/formatting/utils/date";
import { dollars, money } from "~/features/common/formatting/utils/number";

/** What the system has saved so far and a year, and when it pays for itself, from Settings. */
export function Payback({ className }: { className?: string }) {
  const { data: p } = useQuery(paybackQuery);
  const { data: bills } = useQuery(billsQuery);
  const now = useNow(60_000);
  if (!p) return null;
  // The year's saving is the one Your bills shows for the next 12 months, so the two agree; the payback date
  // follows from it. Until that's worked out, the rate the readings so far give.
  const ny = bills?.next_year;
  const perYear = ny ? Math.round(ny.without_solar - ny.net_cost) : p.per_year;
  const left = p.cost && p.saved_total != null ? p.cost - p.saved_total : null;
  const payback_at =
    ny && perYear != null && perYear > 0 && left != null && left > 0
      ? Math.floor(now + (left / perYear) * 365 * 86400)
      : p.payback_at;
  const from = p.installed ?? (p.recorded_from ? parseYmd(p.recorded_from).getTime() / 1000 : null);
  const payback_years =
    payback_at != null && from != null
      ? Math.round(((payback_at - from) / (365.25 * 86400)) * 10) / 10
      : p.payback_years;
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
            <DataRow label="Saving a year" muted={perYear == null}>
              {perYear == null ? "Needs 30 days of readings" : `about ${dollars(perYear)}`}
            </DataRow>
            {p.cost ? (
              <DataRow label="Pays for itself">
                {p.paid_off
                  ? "Already paid off"
                  : payback_at
                    ? `around ${monthYearLong.format(new Date(payback_at * 1000))}${payback_years ? `, ${payback_years} years in` : ""}`
                    : "Needs 30 days of readings"}
              </DataRow>
            ) : null}
            {p.co2_t != null && <DataRow label="CO₂ avoided, lifetime">{p.co2_t.toLocaleString("en-AU")} t</DataRow>}
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
