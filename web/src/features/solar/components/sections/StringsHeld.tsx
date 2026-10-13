import { useState } from "react";
import { duration, hhmm } from "~/features/common/formatting/utils/date";
import { kW, kWh, plural } from "~/features/common/formatting/utils/number";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Figure } from "~/features/common/ui/components/Live";
import { timeTicks, TimeTicks } from "~/features/common/ui/components/TimeLine";
import { cn } from "~/features/common/ui/utils";
import { parts } from "~/features/common/widgets/parts";
import { SOLAR } from "~/features/solar/components/parts";
import type { Causes } from "~/features/solar/types";
import { heldStretches } from "~/features/solar/utils/sections";

/**
 * Output held at the system's limit: on how many of the last 30 days, and about how much more the panels could have
 * made past it (from the insights), with today's stretches at it along the day. Pointing at a stretch puts its times
 * and length in the corner.
 */
export function StringsHeld({
  capped,
  t,
  pv,
  from,
  to,
}: {
  capped: NonNullable<Causes["capped"]>;
  t: number[];
  pv: (number | null)[] | undefined;
  from: number;
  to: number;
}) {
  const held = heldStretches(t, pv, capped.limit_kw * 1000);
  const [on, setOn] = useState<number | null>(null);
  const picked = on != null ? held[on] : null;
  const span = to - from;
  const left = (x: number) => Math.max(0, Math.min(100, ((x - from) / span) * 100));
  const [value, unit] = parts(kWh(capped.kwh));
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <TitleBlock
          className="min-w-0 flex-1"
          title="Held at the limit"
          sub={`Your solar sat at ${kW(capped.limit_kw * 1000)} on ${capped.days} ${plural(capped.days, "day")} of the last 30, when the panels could have made more`}
        />
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="text-xs text-ink-muted tabular-nums">
            {picked ? `${hhmm(picked.from)} to ${hhmm(picked.to)}` : "Held back, 30 days"}
          </span>
          {picked ? <Figure value={duration(picked.to - picked.from)} /> : <Figure value={value} unit={unit} />}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-xs text-ink-muted">
          {held.length
            ? `Today, ${duration(held.reduce((n, h) => n + h.to - h.from, 0))} at ${kW(capped.limit_kw * 1000)}`
            : "Not held today"}
        </div>
        <div className="relative h-6 rounded-lg bg-track" onMouseLeave={() => setOn(null)}>
          {held.map((h, i) => (
            <button
              key={h.from}
              type="button"
              aria-label={`Held from ${hhmm(h.from)} to ${hhmm(h.to)}, ${duration(h.to - h.from)}`}
              onMouseEnter={() => setOn(i)}
              onFocus={() => setOn(i)}
              onBlur={() => setOn(null)}
              className={cn(
                "absolute inset-y-0 rounded-md border-0 p-0 transition-opacity duration-200",
                on != null && on !== i && "opacity-35",
              )}
              style={{
                left: `${left(h.from)}%`,
                width: `${Math.max(1, left(h.to) - left(h.from))}%`,
                background: SOLAR,
              }}
            />
          ))}
        </div>
        <TimeTicks ticks={timeTicks(from, to, 4)} />
      </div>
    </Card>
  );
}
