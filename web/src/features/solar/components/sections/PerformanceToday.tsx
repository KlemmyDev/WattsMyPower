import { kWh, pct } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { dateKey } from "~/features/common/time/utils";
import { Card, Footnote } from "~/features/common/ui/components/Card";
import { PickHead } from "~/features/solar/components/sections/PerformanceParts";
import type { SolarInsights } from "~/features/solar/types";

type Line = { key: string; label: string; kwh: number; color: string; strong?: boolean };

/**
 * Where today's sunlight went, as far as the readings can say: what the weather allowed over today's finished hours
 * (already stopped at the inverter's limit), what the panels made, and the gap between. The readings can't split that
 * gap into heat, dust or shade, so it's shown as one plain line rather than guessed at. Left out until today has
 * enough daylight readings to judge.
 */
export function PerformanceToday({ performance: P, now }: { performance: SolarInsights["performance"]; now: number }) {
  const today = P?.days.find((d) => d.date === dateKey(now));
  if (!today || today.ratio == null || today.actual_kwh == null || today.expected_kwh == null) return null;
  const allowed = today.expected_kwh;
  const made = today.actual_kwh;
  const gap = allowed - made;
  const lines: Line[] = [
    { key: "allowed", label: "The weather allowed", kwh: allowed, color: alpha(COLOR.fg, 0.22), strong: true },
    { key: "made", label: "Made", kwh: made, color: COLOR.solar, strong: true },
  ];
  if (gap > 0.05)
    lines.push({ key: "gap", label: "Not explained by the readings", kwh: gap, color: alpha(COLOR.warn, 0.7) });
  const top = Math.max(allowed, made);
  const capped = P?.causes?.capped;
  return (
    <Card aria-labelledby="h-pt">
      <PickHead
        id="h-pt"
        title="Where today's sunlight went"
        sub={
          gap < 0
            ? `${kWh(-gap)} more than the weather allowed over today's finished hours`
            : `The weather allowed ${kWh(allowed)} over today's finished hours`
        }
        label="Today"
        value={pct(today.ratio * 100)}
      />
      <div className="flex flex-col gap-2.5">
        {lines.map((l) => (
          <div
            key={l.key}
            className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] items-center gap-3 max-sm:grid-cols-[minmax(0,1fr)_auto]"
          >
            <span className={l.strong ? "text-[13px] text-ink" : "text-[13px] text-ink-muted"}>{l.label}</span>
            <span className="relative h-3 rounded-[3px] bg-fg/4 max-sm:col-span-2 max-sm:row-start-2">
              <span
                className="absolute inset-y-0 rounded-[3px] transition-[width] duration-700 ease-out-soft"
                style={{
                  // The gap sits at the end of what was made, so the two add up to what the weather allowed.
                  left: l.key === "gap" ? `${(made / top) * 100}%` : 0,
                  width: `${(l.kwh / top) * 100}%`,
                  background: l.color,
                }}
              />
            </span>
            <span className="text-right text-[13px] whitespace-nowrap tabular-nums max-sm:col-start-2 max-sm:row-start-1">
              {l.key === "gap" ? `−${kWh(l.kwh)}` : kWh(l.kwh)}
            </span>
          </div>
        ))}
      </div>
      <Footnote className="flex-col gap-1.5">
        <span>
          Heat on the panels, dust, shade and wiring each take a share of the gap. The readings can't split it by cause.
        </span>
        {capped && capped.days > 0 && (
          <span>
            {`On top of this, about ${kWh(capped.kwh)} was held at the ${capped.limit_kw} kW limit over the last 30 days. What the weather allowed already stops at the limit.`}
          </span>
        )}
      </Footnote>
    </Card>
  );
}
