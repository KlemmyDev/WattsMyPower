import type { Tariff } from "~/features/common/tariffs/types";
import { Swatch } from "~/features/common/ui/components/Swatch";
import { bandColor, bandTable, tariffNumber, type DayKind } from "~/features/common/tariffs/utils";
import { cn } from "~/features/common/ui/utils";
import { hourLabel, minutesLabel } from "~/features/common/formatting/utils/date";
import { money } from "~/features/common/formatting/utils/number";

const DAY = 1440;
const TICKS = [0, 6, 12, 18, 24];

/** Runs of minutes with the same rate: [start, end, band index]. */
function segments(tab: number[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  let start = 0;
  for (let m = 1; m <= DAY; m++)
    if (m === DAY || tab[m] !== tab[start]) {
      out.push([start, m, tab[start]]);
      start = m;
    }
  return out;
}

function DayRow({ tariff, kind, label }: { tariff: Tariff; kind: DayKind; label: string }) {
  const { bands, tab } = bandTable(tariff, kind);
  return (
    <div className="flex items-center gap-3">
      <span className="w-[72px] flex-none text-xs text-ink-muted">{label}</span>
      <div className="relative h-3.5 flex-1 overflow-hidden rounded bg-surface-raised">
        {segments(tab).map(([a, b, i]) => (
          <div
            key={a}
            className="absolute top-0 bottom-0"
            style={{ left: `${(a / DAY) * 100}%`, width: `${((b - a) / DAY) * 100}%`, background: bandColor(i) }}
            title={`${bands[i].name} ${minutesLabel(a)} to ${minutesLabel(b)}`}
          />
        ))}
      </div>
    </div>
  );
}

/** When each rate applies on weekdays and weekends, with a legend of the rates. */
export function TariffTimeline({ tariff }: { tariff: Tariff }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-canvas p-4">
      <DayRow tariff={tariff} kind="weekday" label="Weekdays" />
      <DayRow tariff={tariff} kind="weekend" label="Weekends" />
      <div className="flex items-center gap-3">
        <span className="w-[72px] flex-none" />
        <div className="relative h-3.5 flex-1">
          {TICKS.map((hr, i) => (
            <span
              key={hr}
              className={cn(
                "absolute font-mono text-[11px] text-ink-faint",
                i === 0 ? "" : i === TICKS.length - 1 ? "-translate-x-full" : "-translate-x-1/2",
              )}
              style={{ left: `${(hr / 24) * 100}%` }}
            >
              {hourLabel(hr)}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-4 pl-[84px] text-xs text-ink-muted max-sm:pl-0">
        {tariff.bands.map((b, i) => (
          <span key={i} className="flex items-center gap-1.5 tabular-nums">
            <Swatch color={bandColor(i)} size={10} />
            {b.name} · {money(tariffNumber(b.rate))}
          </span>
        ))}
      </div>
    </div>
  );
}
