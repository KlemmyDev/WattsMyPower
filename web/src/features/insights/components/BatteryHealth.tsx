import type { Insights } from "~/features/insights/types";
import type { SystemInfo } from "~/features/common/live/types";
import { BigNumber, Card, Muted, TitleBlock } from "~/features/common/ui/components/Card";
import { DataRow } from "~/features/common/ui/components/DataRow";
import { duration } from "~/features/common/formatting/utils/date";
import { kWhInt, pct } from "~/features/common/formatting/utils/number";

const WAIT = "Needs a full day of readings";

export function BatteryHealth({ insights: I, system }: { insights: Insights; system: SystemInfo | undefined }) {
  const L = I.lifetime;
  const B = I.battery;
  const cap = L.battery_kwh || system?.battery_kwh;
  const soh = L.soh;
  const rows: [string, string | null][] = [
    ["Average daily depth of discharge", B.avg_swing != null ? pct(B.avg_swing) : null],
    ["Round-trip efficiency", L.round_trip_pct != null ? pct(L.round_trip_pct) : null],
    ["Time at full charge", B.avg_full_min != null ? `${duration(B.avg_full_min * 60)} a day` : null],
    ["Energy delivered since install", L.discharge_kwh != null ? kWhInt(L.discharge_kwh) : null],
  ];
  return (
    <Card aria-labelledby="h-bhl">
      <TitleBlock
        id="h-bhl"
        title="Battery health"
        sub="Reported by your battery, with charge and discharge figures from your inverter"
      />
      <div className="flex flex-wrap items-baseline gap-3">
        <BigNumber>{pct(soh)}</BigNumber>
        <Muted>
          {soh != null && cap
            ? `about ${((cap * soh) / 100).toFixed(1)} of ${cap} kWh usable`
            : "Not reported by your battery yet"}
        </Muted>
      </div>
      <div className="relative h-2.5 rounded-full bg-track">
        <div
          className="h-full rounded-full bg-battery transition-[width] duration-[320ms] ease-out-soft"
          style={{ width: `${soh ?? 0}%` }}
        />
        <i className="absolute -top-1 -bottom-1 left-[70%] w-0.5 bg-ink" />
      </div>
      <div className="flex justify-between gap-3 text-xs text-ink-faint">
        <span>Warranty threshold 70%</span>
        <span>100% when new</span>
      </div>
      <div>
        {rows.map(([label, value]) => (
          <DataRow key={label} label={label} muted={value == null}>
            {value ?? WAIT}
          </DataRow>
        ))}
      </div>
    </Card>
  );
}
