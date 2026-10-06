import type { Forecast } from "~/features/common/weather/types";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import { Card, CardHeader } from "~/features/common/ui/components/Card";
import { cn } from "~/features/common/ui/utils";
import { batteryOutlook } from "~/features/overview/utils/batteryOutlook";
import { batteryState, reserveOf, type BatteryState } from "~/features/common/energy/utils";
import { pct } from "~/features/common/formatting/utils/number";
import { ARC_LARGE, BatteryArc } from "~/features/overview/components/BatteryArc";
import { BatteryHistory } from "~/features/overview/components/BatteryHistory";
import { BatteryPower } from "~/features/overview/components/BatteryPower";
import { BatteryModeLine } from "~/features/battery/components/BatteryModeLine";
import { useBatteryMode } from "~/features/battery/hooks";
import { useTween } from "~/features/common/ui/hooks/useTween";

/** State of charge ring, time to full (or to reserve), what the battery is set to do, and the last six hours. */
export function BatteryCard({
  p,
  s,
  f,
  now,
  title = "Battery",
  shortcuts = true,
  className,
}: {
  p: Snapshot | null;
  s: SystemInfo | undefined;
  f: Forecast | null | undefined;
  now: number;
  title?: string;
  /** Whether to offer the battery shortcuts (the Battery page has the full controls beside it instead). */
  shortcuts?: boolean;
  className?: string;
}) {
  const st = batteryState(p?.battery_power);
  const discharging = st === "discharge";
  const mode = useBatteryMode();
  const fi = p ? batteryOutlook(p, s, f, now, mode) : null;
  return (
    <Card
      aria-labelledby="h-bat"
      className={cn(
        "relative col-span-6 overflow-hidden px-7 pt-7 pb-0 max-lg:col-span-12 max-sm:px-5 max-sm:pt-5 max-sm:pb-0",
        className,
      )}
    >
      {/* what it's set to do, top right, with the shortcuts; what it's doing is in the ring */}
      <CardHeader
        title={title}
        id="h-bat"
        action={<BatteryModeLine now={now} shortcuts={shortcuts} className="min-w-0 rounded-full" />}
      />
      <div className="relative z-1 flex flex-wrap items-center gap-7">
        {p ? <Ring p={p} s={s} st={st} /> : <div className="size-[168px] flex-none max-sm:size-[140px]" />}
        <div className="flex min-w-[160px] flex-1 flex-col gap-1.5">
          {/* keyed, so a change (to full, to reserve, on standby…) fades in rather than snapping */}
          <span
            key={fi?.eyebrow}
            className={cn(
              "animate-fade text-[13px] leading-5 font-medium",
              discharging ? "text-warn" : "text-ink-muted",
            )}
          >
            {fi?.eyebrow ?? " "}
          </span>
          <span
            key={fi?.headline}
            className={cn(
              "animate-fade text-[34px] leading-10 font-semibold tracking-[-0.04em] tabular-nums",
              discharging && "text-warn",
            )}
          >
            {fi?.headline ?? "—"}
          </span>
          <p className="m-0 text-[13px] leading-5 text-pretty text-ink-muted">{fi?.detail ?? " "}</p>
        </div>
      </div>
      {/* edge to edge along the bottom, its labels padded in, taking what height the row leaves */}
      <BatteryHistory
        end={p ? p.ts + 1 : null}
        s={s}
        className="-mx-7 h-auto min-h-[150px] flex-1 max-sm:-mx-5"
        inset="px-7 max-sm:px-5"
      />
    </Card>
  );
}

/**
 * The battery's ring (see BatteryArc), with the charge in the middle gliding to each reading, what it holds, and what
 * it's doing; the dark dot marks the backup reserve.
 */
function Ring({ p, s, st }: { p: Snapshot; s: SystemInfo | undefined; st: BatteryState | null }) {
  const cap = s?.battery_kwh || 0;
  const soc = p.battery_soc;
  const shown = useTween(soc);
  const reserve = reserveOf(s) / 100;
  return (
    <div className="relative size-[168px] flex-none max-sm:size-[140px]" title={`Backup reserve ${pct(reserve * 100)}`}>
      <BatteryArc frac={(soc || 0) / 100} st={st} size={ARC_LARGE} reserve={reserve} />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 pt-2">
        <div className="text-[52px] leading-[52px] font-medium tracking-[-0.06em] tabular-nums max-sm:text-[42px] max-sm:leading-[44px]">
          {shown == null ? "—" : Math.round(shown)}
          <span className="ml-0.5 text-[22px] font-normal tracking-normal text-ink-muted">%</span>
        </div>
        <div className="text-xs font-medium text-ink-muted tabular-nums">
          {cap && soc != null ? `${((soc / 100) * cap).toFixed(1)} of ${cap} kWh` : ""}
        </div>
        <BatteryPower st={st} w={p.battery_power} />
      </div>
    </div>
  );
}
