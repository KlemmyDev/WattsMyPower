import { centsShort } from "~/features/common/formatting/utils/number";
import type { RateRun } from "~/features/common/tariffs/utils";
import { alpha } from "~/features/common/theme/utils/colors";
import { TooltipRow } from "~/features/common/ui/components/ChartHover";
import { cn } from "~/features/common/ui/utils";

const H = 34;
const STEP = 0.58; // the dearest rate reaches this much of the strip's height, its name above it
const LABEL = 11; // the narrowest stretch (% of the strip) a rate's name is written in

/** The rate in force at `t`, from a day's runs. */
export const rateAt = (runs: RateRun[] | undefined, t: number) => runs?.find((r) => r.from <= t && t < r.to) ?? null;

/** A chart tooltip's line for the rate at `t`: "Rate  Peak · 45c/kWh". */
export function RateRow({ runs, t }: { runs: RateRun[] | undefined; t: number }) {
  const r = rateAt(runs, t);
  return r ? <TooltipRow label="Rate" value={`${r.name} · ${centsShort(r.rate)}/kWh`} color={r.color} /> : null;
}

/**
 * What grid power costs under a chart, on its time scale from `start` to `end`: each rate's stretch as a step in its
 * colour (as tall as it's dear), named where there's room, and the rate now marked. Shows home use against what it
 * costs at the time.
 */
export function RateStrip({ runs, start, end, now }: { runs: RateRun[]; start: number; end: number; now?: number }) {
  const shown = runs.filter((r) => r.to > start && r.from < end);
  if (!shown.length) return null;
  const lo = Math.min(0, ...shown.map((r) => r.rate));
  const hi = Math.max(...shown.map((r) => r.rate), 0.01);
  const left = (t: number) => ((Math.max(start, Math.min(end, t)) - start) / (end - start)) * 100;
  // Top of a rate's step, as a % of the strip from its top; the bottom is nothing (or the cheapest, below nothing).
  const top = (v: number) => 100 - ((v - lo) / (hi - lo)) * STEP * 100;
  const base = top(Math.max(lo, 0));
  const current = now != null && now >= start && now <= end ? rateAt(shown, now) : null;
  const named = (r: RateRun) => left(r.to) - left(r.from) >= LABEL;

  return (
    <div className="relative" style={{ height: H }} aria-label="Rates through the day" role="img">
      {shown.map((r) => (
        <div
          key={r.from}
          aria-hidden
          className="absolute"
          style={{
            left: `${left(r.from)}%`,
            width: `${left(r.to) - left(r.from)}%`,
            top: `${Math.min(top(r.rate), base)}%`,
            height: `${Math.abs(base - top(r.rate))}%`,
            background: alpha(r.color, r === current ? 0.36 : 0.2),
            borderTop: r.rate >= 0 ? `2px solid ${r.color}` : undefined,
            borderBottom: r.rate < 0 ? `2px solid ${r.color}` : undefined,
          }}
        />
      ))}
      <div aria-hidden className="absolute inset-x-0 border-t border-line-subtle" style={{ top: `${base}%` }} />
      {shown.filter(named).map((r) => (
        <span
          key={`n${r.from}`}
          className={cn(
            "absolute top-0 truncate pl-1 text-[10.5px] leading-tight tabular-nums",
            r === current ? "font-medium text-ink" : "text-ink-faint",
          )}
          style={{ left: `${left(r.from)}%`, maxWidth: `${left(r.to) - left(r.from)}%` }}
        >
          {r.name} · {centsShort(r.rate)}
        </span>
      ))}
      {current && now != null && (
        <>
          <span
            aria-hidden
            className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
            style={{ left: `${left(now)}%`, top: `${top(current.rate)}%`, background: current.color }}
          />
          {/* Too narrow to be named (Amber's 5 minutes): what it costs now, by the dot. */}
          {!named(current) && (
            <span
              className={cn(
                "absolute top-0 text-[10.5px] leading-tight font-medium whitespace-nowrap text-ink tabular-nums",
                left(now) > 80 ? "-ml-2 -translate-x-full" : "ml-2",
              )}
              style={{ left: `${left(now)}%` }}
            >
              Now · {centsShort(current.rate)}
            </span>
          )}
        </>
      )}
    </div>
  );
}
