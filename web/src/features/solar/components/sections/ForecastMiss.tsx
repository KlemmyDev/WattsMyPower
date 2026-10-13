import { dayMonth } from "~/features/common/formatting/utils/date";
import { DASH, kWh, pct, signedPct } from "~/features/common/formatting/utils/number";
import { COLOR } from "~/features/common/theme/utils/colors";
import { fromDateKey } from "~/features/common/time/utils";
import { Card } from "~/features/common/ui/components/Card";
import { Delta } from "~/features/common/ui/components/Live";
import { cn } from "~/features/common/ui/utils";
import type { ForecastAccuracy } from "~/features/common/weather/types";
import { ChartKey, dim, KeyItem, PickHead, usePick } from "~/features/solar/components/sections/PerformanceParts";
import { missDays, type MissDay } from "~/features/solar/utils/forecastSections";

/** A miss this far either way fills its half of the chart; further ones are cut off at the edge. */
const CAP = 0.5;
/** Within this either way, a day counts as on the money. */
const CLOSE = 0.1;

const dayName = (d: MissDay) => dayMonth(fromDateKey(d.date));

function missLine(d: MissDay): string {
  const base = `Forecast ${kWh(d.forecast)}, made ${kWh(d.actual)}`;
  if (d.miss == null) return `${base}, too little sun to compare`;
  if (Math.abs(d.miss) < 0.005) return `${base}, right on it`;
  return `${base}, ${pct(Math.abs(d.miss) * 100)} too ${d.miss > 0 ? "high" : "low"}`;
}

/**
 * Each day's miss, as bars either side of a line: above it the forecast promised more than you made, below it you
 * beat it. Pointing at a day reads it out in the header; the corner counts the days it came within 10%.
 */
export function ForecastMiss({ acc }: { acc: ForecastAccuracy }) {
  const pick = usePick();
  const days = missDays(acc);
  if (!days.length) return null;
  const judged = days.filter((d) => d.miss != null);
  const close = judged.filter((d) => Math.abs(d.miss!) <= CLOSE).length;
  const d = pick.picked != null ? days[pick.picked] : null;
  return (
    <Card aria-labelledby="h-fm">
      <PickHead
        id="h-fm"
        title="Each day's miss"
        sub={
          d ? missLine(d) : "Above the line, the forecast promised more than you made. Below it, you beat the forecast."
        }
        label={d ? dayName(d) : `Within ${pct(CLOSE * 100)}`}
        value={d ? (d.miss != null ? signedPct(d.miss) : DASH) : `${close} of ${judged.length}`}
        chip={
          d?.miss != null && Math.abs(d.miss) >= 0.005 ? (
            <Delta value={-d.miss}>{d.miss > 0 ? "Too high" : "You beat it"}</Delta>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-1.5">
        <div className="relative flex h-40 gap-1 max-sm:h-32 max-sm:gap-0.5" {...pick.plot}>
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-line-strong" />
          {days.map((x, i) => {
            const h = x.miss == null ? 0 : (Math.min(Math.abs(x.miss), CAP) / CAP) * 50;
            return (
              <button
                key={x.date}
                type="button"
                {...pick.item(i)}
                aria-label={`${dayName(x)}: ${missLine(x)}`}
                className={cn(
                  "relative h-full min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0",
                  dim(pick.picked, i),
                )}
              >
                <span
                  className={cn(
                    "absolute inset-x-0 rounded-[3px]",
                    x.miss != null && x.miss > 0 ? "bottom-1/2" : "top-1/2",
                  )}
                  style={{
                    height: `${Math.max(1, h).toFixed(1)}%`,
                    background: x.miss == null ? COLOR.track : x.miss > 0 ? COLOR.bar : COLOR.solar,
                  }}
                />
              </button>
            );
          })}
        </div>
        <div className="flex justify-between text-[11px] text-ink-faint tabular-nums">
          <span>{dayName(days[0])}</span>
          <span>{dayName(days[days.length - 1])}</span>
        </div>
      </div>
      <ChartKey>
        <KeyItem swatch={<i className="size-2.5 rounded-[3px]" style={{ background: COLOR.bar }} />}>
          Forecast too high
        </KeyItem>
        <KeyItem swatch={<i className="size-2.5 rounded-[3px] bg-solar" />}>You beat it</KeyItem>
        <span className="text-ink-faint">{`Cut off at ${pct(CAP * 100)} either way`}</span>
      </ChartKey>
    </Card>
  );
}
