import type { HTMLAttributes, ReactNode } from "react";
import type { Insights } from "~/features/health/types";
import type { SystemInfo } from "~/features/common/live/types";
import { Eyebrow, Muted } from "~/features/common/ui/components/Card";
import { cn } from "~/features/common/ui/utils";
import { DASH, pct, plural } from "~/features/common/formatting/utils/number";

/** A headline figure, e.g. "87%"; `small` for the one beside a card title. */
export function Figure({ small, ...rest }: { small?: boolean } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "font-light tracking-[-1.5px] tabular-nums",
        small ? "text-[32px] leading-9" : "text-[40px] leading-11",
      )}
      {...rest}
    />
  );
}

function Kpi({ label, value, note }: { label: string; value: ReactNode; note: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-3xl border border-line-subtle bg-surface p-6">
      <Eyebrow>{label}</Eyebrow>
      <Figure>{value}</Figure>
      <Muted>{note}</Muted>
    </div>
  );
}

/** How self-sufficiency over the last 30 days compares with the 30 before. */
function selfNote(I: Insights): string {
  const ss = I.last30.self_pct;
  const prev = I.prev30.self_pct;
  const n30 = I.last30.days;
  if (ss != null && prev != null && I.prev30.days >= 7) {
    const d = Math.abs(Math.round(ss) - Math.round(prev));
    if (d === 0) return "Same as the 30 days before";
    return `${ss > prev ? "Up" : "Down"} ${d} ${plural(d, "point")} on the 30 days before`;
  }
  if (n30 && n30 < 30) return `From ${n30} ${plural(n30, "day")} of readings so far`;
  return "Share of home use from solar and the battery";
}

export function Kpis({ insights: I, system }: { insights: Insights; system: SystemInfo | undefined }) {
  const L = I.lifetime;
  const cap = L.battery_kwh || system?.battery_kwh;
  const n30 = I.last30.days;
  const used = I.last30.pv_home_pct;
  const cyclesPerDay = cap && n30 ? I.last30.dis / cap / n30 : null;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-5">
      <Kpi
        label="Self-sufficiency · 30 days"
        value={pct(I.last30.self_pct)}
        note={n30 ? selfNote(I) : "No readings yet"}
      />
      <Kpi
        label="Solar used at home · 30 days"
        value={pct(used)}
        note={
          used == null
            ? "No solar recorded yet"
            : Math.round(used) >= 100
              ? "None was exported to the grid"
              : `The other ${100 - Math.round(used)}% was exported to the grid`
        }
      />
      <Kpi
        label="Battery cycles"
        value={L.cycles == null ? DASH : L.cycles.toLocaleString("en-AU")}
        note={
          cyclesPerDay != null
            ? `About ${cyclesPerDay.toFixed(1)} full cycles a day over the last ${n30 === 1 ? "day" : `${n30} days`}`
            : "Full charge-discharge cycles since the battery was installed"
        }
      />
    </div>
  );
}
