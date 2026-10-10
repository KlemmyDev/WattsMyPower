import { Link } from "@tanstack/react-router";
import type { BatteryMonth, Insights } from "~/features/battery/types/insights";
import type { SystemInfo } from "~/features/common/live/types";
import { BigNumber, Card, Eyebrow, Muted, TitleBlock } from "~/features/common/ui/components/Card";
import { DataRow } from "~/features/common/ui/components/DataRow";
import { cn } from "~/features/common/ui/utils";
import { duration, monthYear, parseYmd } from "~/features/common/formatting/utils/date";
import { DASH, kWhInt, pct } from "~/features/common/formatting/utils/number";

const WAIT = "Needs a full day of readings";

export function BatteryHealth({
  insights: I,
  system,
  className,
}: {
  insights: Insights;
  system: SystemInfo | undefined;
  className?: string;
}) {
  const L = I.lifetime;
  const B = I.battery;
  const cap = L.battery_kwh || system?.battery_kwh;
  const soh = L.soh;
  const n30 = I.last30.days;
  const perDay = cap && n30 ? I.last30.dis / cap / n30 : null;
  const rows: [string, string | null][] = [
    [
      "Full cycles since install",
      L.cycles == null
        ? null
        : `${L.cycles.toLocaleString("en-AU")}${perDay != null ? `, about ${perDay.toFixed(1)} a day lately` : ""}`,
    ],
    ["Average daily depth of discharge", B.avg_swing != null ? pct(B.avg_swing) : null],
    ["Round-trip efficiency", L.round_trip_pct != null ? pct(L.round_trip_pct) : null],
    ["Time at full charge", B.avg_full_min != null ? `${duration(B.avg_full_min * 60)} a day` : null],
    ["Energy delivered since install", L.discharge_kwh != null ? kWhInt(L.discharge_kwh) : null],
  ];
  return (
    <Card aria-labelledby="h-bhl" className={className}>
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
          className="h-full origin-left animate-fill-x rounded-full bg-battery transition-[width] duration-[320ms] ease-out-soft"
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
      <BatteryMonths months={B.months} />
      <Warranty w={I.warranty} />
    </Card>
  );
}

/** The last six months with anything through the battery: its health, efficiency and cycles, to see a trend. */
function BatteryMonths({ months }: { months: BatteryMonth[] }) {
  const shown = months.filter((m) => m.soh != null || m.efficiency != null).slice(-6);
  if (shown.length < 2) return null;
  return (
    <div className="flex flex-col gap-2">
      <Eyebrow>Month by month</Eyebrow>
      <table className="w-full border-collapse text-[13px] tabular-nums">
        <thead className="text-xs text-ink-muted">
          <tr>
            <th className="py-1.5 text-left font-medium">Month</th>
            <th className="py-1.5 text-right font-medium">Health</th>
            <th className="py-1.5 text-right font-medium">Efficiency</th>
            <th className="py-1.5 text-right font-medium">Cycles</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((m) => (
            <tr key={m.month} className="border-t border-line-subtle">
              <td className="py-1.5">{monthYear.format(parseYmd(m.month))}</td>
              <td className="py-1.5 text-right">{pct(m.soh)}</td>
              <td className="py-1.5 text-right">{pct(m.efficiency)}</td>
              <td className="py-1.5 text-right">{m.cycles ?? DASH}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** How much of the warranty is used, by years and by energy delivered; or where to set it. */
function Warranty({ w }: { w: Insights["warranty"] }) {
  if (!w)
    return (
      <Muted>
        Add the battery's warranty in{" "}
        <Link to="/settings/cost" className="text-link">
          Settings → Cost and warranty
        </Link>{" "}
        to track how much of it is used.
      </Muted>
    );
  const bars: [label: string, used: number, note: string][] = [];
  if (w.time_pct != null && w.years && w.ends)
    bars.push([
      "Warranty years",
      w.time_pct,
      `${((w.years * w.time_pct) / 100).toFixed(1)} of ${w.years} years, ends ${monthYear.format(new Date(w.ends * 1000))}`,
    ]);
  if (w.energy_pct != null && w.mwh)
    bars.push(["Warranty energy", w.energy_pct, `${w.used_mwh} of ${w.mwh} MWh delivered`]);
  if (!bars.length) return <Muted>Add when the battery was installed in Settings to track its warranty years.</Muted>;
  return (
    <div className="flex flex-col gap-3">
      <Eyebrow>Warranty used</Eyebrow>
      {bars.map(([label, used, note]) => (
        <div key={label} className="flex flex-col gap-1.5">
          <div className="flex justify-between gap-3 text-[13px]">
            <span className="text-ink">{label}</span>
            <span className="text-ink-muted tabular-nums">{note}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-track">
            <div
              className={cn("h-full origin-left animate-fill-x rounded-full", used >= 90 ? "bg-warn" : "bg-battery")}
              style={{ width: `${used}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
