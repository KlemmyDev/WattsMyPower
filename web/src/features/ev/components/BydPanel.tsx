import { hhmm } from "~/features/common/formatting/utils/date";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Card } from "~/features/common/ui/components/Card";
import { useTween } from "~/features/common/ui/hooks/useTween";
import type { BydCar } from "~/features/ev/types";
import { STATUS_LABEL, statusColor } from "~/features/ev/utils";

/** How fresh what's shown is: when the car last sent its state to BYD, and whether it's reachable now. */
function freshness(v: BydCar): string {
  const s = v.state;
  if (!s) return "Not heard from yet";
  return [s.as_of ? `Charge read ${hhmm(s.as_of)}` : "Charge read", !s.online && "the car's offline now"]
    .filter(Boolean)
    .join(" · ");
}

/**
 * A BYD at a glance, as BYD's cloud last had it: its charge, big, over a bar; its range and odometer; and what it's
 * doing in a sentence. Only read: the dashboard can't charge a BYD from spare solar (BYD's cloud can't stop a charge
 * or set its current), so there's nothing to set here.
 */
export function BydPanel({ v }: { v: BydCar }) {
  const s = v.state;
  const soc = useTween(s?.soc ?? undefined) ?? s?.soc ?? null;
  const tone = statusColor(v.status, "off");
  return (
    <Card aria-labelledby={`h-byd-${v.vin}`} className="gap-6 overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={`h-byd-${v.vin}`} className="text-sm font-medium" style={{ color: tone }}>
            {v.name ?? v.model ?? "Your BYD"} · {STATUS_LABEL[v.status]}
          </h2>
          <div className="flex items-baseline gap-1 leading-none">
            <span className="text-[88px] font-light tracking-[-4px] tabular-nums max-sm:text-[64px] max-sm:tracking-[-3px]">
              {soc == null ? "—" : Math.round(soc)}
            </span>
            <span className="text-3xl font-light text-ink-muted">%</span>
          </div>
          <span className="text-sm text-ink-muted tabular-nums">
            {[
              s?.range_km != null && `${s.range_km} km${v.hybrid ? " on the battery" : ""}`,
              s?.odometer_km != null && `${s.odometer_km.toLocaleString()} km on the odometer`,
            ]
              .filter(Boolean)
              .join(" · ") || " "}
          </span>
          <span className="text-xs text-ink-faint tabular-nums">{freshness(v)}</span>
        </div>
        <div className="flex max-w-[420px] min-w-0 flex-col items-start gap-2 max-sm:max-w-none">
          <span className="text-sm text-pretty">{v.doing}</span>
          <span className="-mt-1 text-[13px] text-pretty text-ink-muted">
            Read through BYD's cloud every 10 minutes (every 5 while it charges). The dashboard only reads it.
          </span>
        </div>
      </div>
      <div className="relative h-3 overflow-hidden rounded-full bg-track">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${Math.min(100, soc ?? 0)}%`, background: s?.charging ? tone : COLOR.battery }}
        />
      </div>
    </Card>
  );
}
