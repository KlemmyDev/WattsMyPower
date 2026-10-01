import type { Forecast } from "~/features/common/weather/types";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import { Card, CardHeader } from "~/features/common/ui/components/Card";
import { cn } from "~/features/common/ui/utils";
import { batteryOutlook } from "~/features/overview/utils/batteryOutlook";
import { batteryState, reserveOf, type BatteryState } from "~/features/common/energy/utils";
import { kW, pct } from "~/features/common/formatting/utils/number";
import { BatteryHistory } from "~/features/overview/components/BatteryHistory";

/** State of charge ring, time to full (or to reserve), and the last six hours. */
export function BatteryCard({
  p,
  s,
  f,
  now,
}: {
  p: Snapshot | null;
  s: SystemInfo | undefined;
  f: Forecast | null | undefined;
  now: number;
}) {
  const st = batteryState(p?.battery_power);
  const discharging = st === "discharge";
  const fi = p ? batteryOutlook(p, s, f, now) : null;
  return (
    <Card
      aria-labelledby="h-bat"
      className="relative col-span-6 min-h-[400px] overflow-hidden px-7 pt-7 pb-0 max-lg:col-span-12 max-sm:px-5 max-sm:pt-5 max-sm:pb-0"
    >
      <CardHeader title="Battery" id="h-bat" action={<StatePill st={p ? st : null} w={p?.battery_power} />} />
      <div className="relative z-1 flex flex-wrap items-center gap-7">
        {p ? (
          <Ring p={p} s={s} discharging={discharging} />
        ) : (
          <div className="size-[168px] flex-none max-sm:size-[140px]" />
        )}
        <div className="flex min-w-[160px] flex-1 flex-col gap-1.5">
          <div
            className={cn(
              "font-mono text-[11px] tracking-[1.5px] uppercase",
              discharging ? "text-warn opacity-80" : "text-ink-faint",
            )}
          >
            {fi?.eyebrow ?? " "}
          </div>
          <div
            className={cn(
              "text-[36px] leading-10 font-light tracking-[-1.5px] tabular-nums",
              discharging && "text-warn",
            )}
          >
            {fi?.headline ?? "—"}
          </div>
          <div className="text-[13px] leading-5 text-pretty text-ink-muted">{fi?.detail ?? " "}</div>
        </div>
      </div>
      <BatteryHistory end={p ? p.ts + 1 : null} s={s} />
    </Card>
  );
}

function StatePill({ st, w }: { st: BatteryState | null; w: number | null | undefined }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-[5px] text-xs font-semibold whitespace-nowrap",
        st === "charge"
          ? "bg-battery/14 text-link"
          : st === "discharge"
            ? "bg-solar/14 text-warn"
            : "bg-white/6 text-ink-muted",
      )}
    >
      {st == null ? (
        "—"
      ) : (
        <>
          <span className="text-[13px] leading-none">{st === "charge" ? "↑" : st === "discharge" ? "↓" : "•"}</span>
          {st === "charge" ? `Charging at ${kW(w)}` : st === "discharge" ? `Discharging at ${kW(w)}` : "Idle"}
        </>
      )}
    </span>
  );
}

const R0 = 82;
const C0 = 2 * Math.PI * R0;

/** Battery ring (the dark dot marks the backup reserve). */
function Ring({ p, s, discharging }: { p: Snapshot; s: SystemInfo | undefined; discharging: boolean }) {
  const cap = s?.battery_kwh || 0;
  const soc = p.battery_soc;
  const reserve = reserveOf(s) / 100;
  const frac = Math.max(0, Math.min(1, (soc || 0) / 100));
  return (
    <div className="relative size-[168px] flex-none max-sm:size-[140px]" title={`Backup reserve ${pct(reserve * 100)}`}>
      <svg viewBox="0 0 188 188" aria-hidden="true" className="absolute inset-0 size-full -rotate-90">
        <circle cx="94" cy="94" r={R0} fill="none" stroke="#26262a" strokeWidth="10" />
        <circle
          className={cn(discharging && "animate-ring-drain")}
          cx="94"
          cy="94"
          r={R0}
          fill="none"
          stroke={discharging ? "#ffb547" : "#6f8cff"}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${(C0 * frac).toFixed(1)} ${C0.toFixed(1)}`}
          style={{ transition: "stroke-dasharray 320ms ease" }}
        />
        <circle
          cx={(94 + R0 * Math.cos(2 * Math.PI * reserve)).toFixed(1)}
          cy={(94 + R0 * Math.sin(2 * Math.PI * reserve)).toFixed(1)}
          r="3"
          fill="#0a0a0a"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
        <div className="text-[52px] leading-[52px] font-light tracking-[-3px] tabular-nums max-sm:text-[42px] max-sm:leading-[44px]">
          {soc == null ? "—" : Math.round(soc)}
          <span className="text-[22px] tracking-normal text-ink-muted">%</span>
        </div>
        <div className="font-mono text-[11px] text-ink-faint tabular-nums">
          {cap && soc != null ? `${((soc / 100) * cap).toFixed(1)} / ${cap} kWh` : ""}
        </div>
      </div>
    </div>
  );
}
