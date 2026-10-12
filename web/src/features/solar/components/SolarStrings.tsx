import { DASH, kW, kWh, pct } from "~/features/common/formatting/utils/number";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Delta, Meter } from "~/features/solar/components/parts";
import { invertersOf, stringsOf } from "~/features/solar/utils";

/** Strings this far apart in the sun are worth a look. */
const APART = 0.2;

/**
 * Each string of panels as the hybrid tracks it (MPPT): a column of its power, the stronger one full, with its volts
 * and amps under it, and how far apart they are. A string well behind the other in full sun is shade, dirt or a fault.
 * With a second inverter, a line for each inverter under them.
 */
export function SolarStrings({ p, s }: { p: Snapshot | null; s: SystemInfo | undefined }) {
  const { list, apart } = stringsOf(p);
  const inverters = invertersOf(p, s);
  if (!list.length && !inverters.length) return null;
  const top = Math.max(1, ...list.map((x) => x.w ?? 0));
  const most = Math.max(1, ...inverters.map((x) => x.w ?? 0));
  return (
    <Card className="h-full">
      <div className="flex items-start justify-between gap-3">
        <TitleBlock
          className="min-w-0 flex-1"
          title={list.length ? "Strings" : "Inverters"}
          sub={
            list.length
              ? "Each string of panels now. One well behind the other in full sun is worth a look."
              : "Each inverter's solar now"
          }
        />
        {apart != null && (
          <Delta value={apart > APART ? -apart : 0}>{apart > APART ? `${pct(apart * 100)} apart` : "Even"}</Delta>
        )}
      </div>
      {list.length > 0 && (
        <div className="flex items-end justify-center gap-8 py-1">
          {list.map((x) => (
            <div key={x.n} className="flex flex-col items-center gap-2">
              <span className="text-[17px] font-light tabular-nums">{kW(x.w)}</span>
              <span className="relative h-28 w-14 overflow-hidden rounded-2xl bg-track">
                <span
                  className="absolute inset-x-0 bottom-0 rounded-2xl transition-[height] duration-700 ease-out-soft"
                  style={{
                    height: `${((x.w ?? 0) / top) * 100}%`,
                    background: `linear-gradient(to top, ${COLOR.solarDeep}, ${COLOR.solar})`,
                  }}
                />
              </span>
              <span className="flex flex-col items-center text-[11.5px] leading-4 text-ink-faint tabular-nums">
                <span className="text-ink-muted">String {x.n}</span>
                {x.v != null ? `${Math.round(x.v)} V` : DASH} · {x.a != null ? `${x.a.toFixed(1)} A` : DASH}
              </span>
            </div>
          ))}
        </div>
      )}
      {inverters.length > 0 && (
        <ul className="flex flex-col gap-3 border-t border-line-subtle pt-4">
          {inverters.map((x) => (
            <li key={x.name} className="flex flex-col gap-1.5">
              <div className="flex items-baseline gap-2 text-[13.5px]">
                <span className="min-w-0 flex-1 truncate">{x.name}</span>
                <span className="text-xs text-ink-faint tabular-nums">
                  {x.kwh != null ? `${kWh(x.kwh)} today` : ""}
                  {x.temp != null ? ` · ${Math.round(x.temp)}°C` : ""}
                </span>
                <span className="w-16 text-right tabular-nums">{kW(x.w)}</span>
              </div>
              <Meter share={(x.w ?? 0) / most} />
            </li>
          ))}
        </ul>
      )}
      {!inverters.length && p?.inverter_temp != null && (
        <div className="text-xs text-ink-faint">Inverter at {Math.round(p.inverter_temp)}°C</div>
      )}
    </Card>
  );
}
