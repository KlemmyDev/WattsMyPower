import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { DASH, kWh, kWhInt, plural } from "~/features/common/formatting/utils/number";
import { parseYmd, shortDay } from "~/features/common/formatting/utils/date";
import { Button } from "~/features/common/ui/components/Button";
import { reconcileQuery } from "~/features/meter/api";
import type { ReconcileDay, Reconciliation } from "~/features/meter/types";
import { versusMeter, ymdSpan } from "~/features/meter/utils";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";

const SHOWN = 8; // the most recent days that differ, listed before "Show every day"
const SHARE = 0.05; // a consistent difference worth explaining
const COLUMNS = "grid grid-cols-[1fr_auto_auto] gap-x-6 border-b border-line-subtle max-sm:gap-x-4";

/** A day's meter figure, with the dashboard's (and the difference) underneath. */
function Figure({ meter, dashboard, diff }: { meter: number; dashboard: number | null; diff: number | null }) {
  return (
    <div className="flex flex-col items-end tabular-nums">
      <span className="font-medium">{kWh(meter)}</span>
      <span className="text-xs text-ink-faint">
        {dashboard == null ? "no readings" : kWh(dashboard)}
        {diff != null && Math.abs(diff) >= 0.05 && ` (${diff > 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)})`}
      </span>
    </div>
  );
}

function DayRow({ day }: { day: ReconcileDay }) {
  const note = !day.complete
    ? "Part of the day"
    : day.notable
      ? "Differs"
      : day.estimated > 0
        ? "Includes estimates"
        : "";
  return (
    <div className={`${COLUMNS} items-center py-2.5 text-[13px]`}>
      <div className="flex flex-col">
        <span className="font-medium">{shortDay.format(parseYmd(day.date))}</span>
        <span className="text-xs text-ink-faint">{note}</span>
      </div>
      <Figure meter={day.meter_import} dashboard={day.dashboard_import} diff={day.import_diff} />
      <Figure meter={day.meter_export} dashboard={day.dashboard_export} diff={day.export_diff} />
    </div>
  );
}

const integrations = (
  <Link to="/settings/integrations/sungrow" className="text-link hover:text-link-hover">
    Settings → Integrations → Sungrow
  </Link>
);

/** Why the two might differ, when they consistently do. A second inverter's wiring is the usual cause. */
function Explanation({ s }: { s: NonNullable<Reconciliation["summary"]> }) {
  const share = (dash: number, meter: number) => (meter > 0 ? (dash - meter) / meter : 0);
  const exp = share(s.dashboard_export, s.meter_export);
  const imp = share(s.dashboard_import, s.meter_import);
  if (exp < -SHARE)
    return (
      <>
        The dashboard counts less export than your meter. If a second inverter is wired outside the main inverter's
        meter, say so in {integrations} so all of its output counts as exported.
      </>
    );
  if (exp > SHARE)
    return (
      <>
        The dashboard counts more export than your meter. If a second inverter is set as wired outside the main
        inverter's meter but is on the house side of it, change that in {integrations}.
      </>
    );
  if (Math.abs(imp) > SHARE)
    return (
      <>
        Gaps in the inverter's readings, or its meter seeing a different wire to your retailer's meter, can make the two
        differ. Bills use your meter's figures wherever it covers a day.
      </>
    );
  return null;
}

/** Settings → Bills: the meter's daily import and export against the dashboard's, and the days that differ. */
export function MeterComparison() {
  const { data } = useQuery(reconcileQuery);
  const [all, setAll] = useState(false);
  const s = data?.summary;
  if (!data || !s || !data.days.length) return null;
  const listed = [...(all ? data.days : data.days.filter((d) => d.notable).slice(-SHOWN))].reverse();

  return (
    <SettingsCard aria-labelledby="h-compare">
      <div className="border-b border-line-subtle p-6 max-sm:px-4">
        <SettingsTitle
          id="h-compare"
          title="Meter and dashboard compared"
          sub={`Grid import and export each day from ${s.first && s.last ? ymdSpan(s.first, s.last) : DASH}, as your meter and the inverter counted them`}
        />
      </div>
      <div className="flex flex-col gap-4 border-b border-line-subtle px-6 py-5 max-sm:px-4">
        {s.compared_days === 0 ? (
          <span className="text-[13px] text-ink-muted">
            There are no full days with both meter data and inverter readings to compare yet.
          </span>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              {(
                [
                  ["From the grid", s.meter_import, s.dashboard_import],
                  ["To the grid", s.meter_export, s.dashboard_export],
                ] as const
              ).map(([label, meter, dash]) => (
                <div key={label} className="flex flex-col gap-0.5 rounded-xl bg-canvas px-4 py-3">
                  <span className="text-xs text-ink-muted">{label}</span>
                  <span className="text-lg font-semibold tabular-nums">{kWhInt(meter)} on your meter</span>
                  <span className="text-[13px] text-ink-muted tabular-nums">
                    Dashboard {kWhInt(dash)}, {versusMeter(dash, meter)}
                  </span>
                </div>
              ))}
            </div>
            <span className="text-[13px] leading-5 text-pretty text-ink-muted">
              Over {s.compared_days} full {plural(s.compared_days, "day")}.{" "}
              {s.notable_days > 0
                ? `${s.notable_days} ${plural(s.notable_days, "day differs", "days differ")} by more than half a kWh and 10%.`
                : "No day differs by more than half a kWh and 10%."}{" "}
              <Explanation s={s} />
            </span>
          </>
        )}
      </div>
      {listed.length > 0 && (
        <div className="flex flex-col px-6 pt-2 max-sm:px-4">
          <div className={`${COLUMNS} py-2 text-xs text-ink-muted`}>
            <span>Meter, then dashboard</span>
            <span className="text-right">From grid</span>
            <span className="text-right">To grid</span>
          </div>
          {listed.map((d) => (
            <DayRow key={d.date} day={d} />
          ))}
        </div>
      )}
      <div className="px-6 py-4 max-sm:px-4">
        <Button variant="link" size="sm" onClick={() => setAll((a) => !a)}>
          {all ? "Show only the days that differ" : `Show every day (${data.days.length})`}
        </Button>
      </div>
    </SettingsCard>
  );
}
