import { kW, kWh, pct } from "~/features/common/formatting/utils/number";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { cn } from "~/features/common/ui/utils";
import { invertersOf, solarNow, stringsOf } from "~/features/solar/utils";

/** Strings this far apart in the sun are worth a look (as on the Strings widget). */
const APART = 0.2;

/**
 * The panels' hardware in plain words: each inverter's solar now (a bar of its size), today and its temperature, then
 * the hybrid's strings side by side, with a line on whether they're working evenly.
 */
export function YourPanels({ p, s, now }: { p: Snapshot | null; s: SystemInfo | undefined; now: number }) {
  const live = solarNow(p, s, null, now);
  const two = invertersOf(p, s);
  const inverters = two.length
    ? two.map((x, i) => ({
        ...x,
        kind: i ? "Second inverter" : "Hybrid inverter, runs the battery",
        size: i ? s?.pv2?.nominal_kw : s?.nominal_kw,
      }))
    : [
        {
          name: s?.model ?? "Inverter",
          kind: s?.brand ? `${s.brand} inverter` : "Inverter",
          w: p?.pv_power ?? null,
          kwh: p?.daily_pv ?? null,
          temp: p?.inverter_temp ?? null,
          size: s?.nominal_kw ?? s?.pv_kw,
        },
      ];
  const strings = stringsOf(p);
  const top = Math.max(100, ...strings.list.map((x) => x.w ?? 0));
  const weak = strings.list.length === 2 ? strings.list.reduce((a, b) => ((a.w ?? 0) <= (b.w ?? 0) ? a : b)) : null;
  const strong = weak && strings.list.find((x) => x !== weak);
  const uneven = strings.apart != null && strings.apart > APART;
  const sub = !p
    ? "Waiting for the first reading"
    : live.producing
      ? two.length
        ? "Both inverters are making power"
        : "Your inverter is making power"
      : "Resting until the sun is up";
  return (
    <Card aria-labelledby="h-yp" className="gap-4">
      <div className="flex items-start justify-between gap-4">
        <TitleBlock id="h-yp" title="Your panels" sub={sub} />
        <div className="flex flex-col items-end gap-0.5 tabular-nums">
          <span className="text-xs text-ink-faint">Now</span>
          <span className="text-[28px] leading-8 font-light tracking-[-1px] whitespace-nowrap">{kW(live.pv ?? 0)}</span>
        </div>
      </div>
      <div className="flex flex-col">
        {inverters.map((x) => (
          <div key={x.name} className="flex flex-col gap-2 border-t border-line-subtle py-3">
            <div className="flex items-baseline gap-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ink">{x.name}</span>
                <span className="block text-xs text-ink-faint">{x.kind}</span>
              </span>
              <span className="text-[17px] font-light whitespace-nowrap tabular-nums">{kW(x.w ?? 0)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-track">
              <div
                className="h-full rounded-full bg-solar transition-[width] duration-700 ease-out-soft"
                style={{ width: `${x.size ? Math.min(100, ((x.w ?? 0) / (x.size * 1000)) * 100) : 0}%` }}
              />
            </div>
            <div className="text-xs text-ink-faint tabular-nums">
              {[x.kwh != null ? `${kWh(x.kwh)} today` : null, x.temp != null ? `${Math.round(x.temp)} °C` : null]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        ))}
      </div>
      {strings.list.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-line-subtle pt-3.5">
          <div className="text-[13px] text-ink-muted">Strings on the {inverters[0].name}</div>
          <div className="grid grid-cols-2 gap-3">
            {strings.list.map((x) => (
              <div key={x.n} className="flex items-end gap-3">
                <div className="relative h-[68px] w-9 flex-none overflow-hidden rounded-[10px] bg-track">
                  <div
                    className="absolute inset-x-0 bottom-0 rounded-[10px] bg-linear-to-t from-solar-deep to-solar transition-[height] duration-700 ease-out-soft"
                    style={{ height: `${((x.w ?? 0) / top) * 100}%` }}
                  />
                </div>
                <div className="tabular-nums">
                  <div className="text-[13px] text-ink-body">String {x.n}</div>
                  <div className="text-xl font-light">{kW(x.w ?? 0)}</div>
                  <div className="text-xs text-ink-faint">
                    {x.w != null && x.w > 20 ? `${Math.round(x.v ?? 0)} V · ${(x.a ?? 0).toFixed(1)} A` : "Resting"}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {strings.list.length === 2 && (
            <p className="flex items-start gap-2 text-[13px] text-ink-body">
              <span className={cn("mt-1.5 size-2 flex-none rounded-full", uneven ? "bg-solar" : "bg-good")} />
              <span>
                {strings.apart == null
                  ? "Both strings are resting."
                  : uneven && weak && strong
                    ? `String ${weak.n} is about ${pct((1 - (weak.w ?? 0) / Math.max(strong.w ?? 0, 1)) * 100)} behind string ${strong.n} right now. Strings that face different ways always differ, but if it's well behind in full sun, look for shade, dirt or a fault.`
                    : "Both strings are working evenly."}
              </span>
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
