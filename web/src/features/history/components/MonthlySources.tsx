import { useState } from "react";
import { dollars, intAU } from "~/features/common/formatting/utils/number";
import { cn } from "~/features/common/ui/utils";
import { HCARD } from "~/features/history/components/parts";
import type { Month } from "~/features/history/utils/year";

const SOURCES = [
  { label: "Solar used directly", color: "#ffb547" },
  { label: "From the battery", color: "#6f8cff" },
  { label: "From the grid", color: "#5a5a60" },
];

/** A round top for the chart: the next multiple of a step that suits the size. */
function niceMax(v: number) {
  const step = v > 1000 ? 200 : v > 200 ? 50 : 10;
  return Math.max(step, Math.ceil(v / step) * step);
}

/** Each month's home use as a bar split by where it came from, with the chosen month in figures beside it. */
export function MonthlySources({ months }: { months: Month[] }) {
  const [picked, setPicked] = useState<string | null>(null);
  if (!months.length) return null;
  const sel = months.find((m) => m.key === picked) ?? months[months.length - 1];
  const top = niceMax(Math.max(...months.map((m) => m.home)));
  const pc = (v: number) => `${((v / top) * 100).toFixed(2)}%`;
  const rows: [string, string, string][] = [
    ["Solar used directly", `${intAU(sel.direct)} kWh`, "#ffb547"],
    ["From the battery", `${intAU(sel.battery)} kWh`, "#6f8cff"],
    ["From the grid", `${intAU(sel.imp)} kWh`, "#5a5a60"],
    ["Sent to the grid", `${intAU(sel.exp)} kWh`, "#f2a65a"],
    [
      "Self-sufficiency",
      sel.home > 0 ? `${Math.round(((sel.direct + sel.battery) / sel.home) * 100)}%` : "—",
      "#3ee08f",
    ],
    ["Saved", dollars(sel.saved), "#f5f5f5"],
  ];
  return (
    <section aria-labelledby="h-months" className={cn(HCARD, "gap-6")}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 id="h-months">Where your power came from</h2>
          <span className="text-[13px] text-ink-dim">Home use each month · select a month for details</span>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-ink-dim">
          {SOURCES.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <i className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-stretch gap-8">
        <div className="flex min-w-0 flex-[2_1_480px] flex-col gap-2">
          <div className="relative flex h-[260px] gap-1.5 pr-16 max-sm:h-[200px] max-sm:gap-1 max-sm:pr-12">
            {[1, 0.5].map((q) => (
              <div
                key={q}
                className="pointer-events-none absolute inset-x-0 border-t border-white/5"
                style={{ top: `${(1 - q) * 100}%` }}
              >
                <span className="absolute -top-[7px] right-0 font-mono text-[10px] leading-[14px] text-ink-faint">
                  {intAU(top * q)} kWh
                </span>
              </div>
            ))}
            {months.map((m) => {
              const on = m.key === sel.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  title={`${m.name} ${m.year}: ${intAU(m.home)} kWh used`}
                  aria-label={`${m.name} ${m.year}: ${intAU(m.home)} kWh used`}
                  aria-pressed={on}
                  onClick={() => setPicked(m.key)}
                  onMouseEnter={() => setPicked(m.key)}
                  className={cn(
                    "flex h-full max-w-16 min-w-0 flex-1 flex-col justify-end gap-0.5 border-0 bg-transparent p-0 transition-opacity duration-200",
                    on ? "opacity-100" : "opacity-45",
                  )}
                >
                  <span className="rounded-t-[4px] bg-[#5a5a60]" style={{ height: pc(m.imp) }} />
                  <span className="bg-battery" style={{ height: pc(m.battery) }} />
                  <span className="rounded-b-[4px] bg-solar" style={{ height: pc(m.direct) }} />
                </button>
              );
            })}
          </div>
          <div className="flex gap-1.5 pr-16 max-sm:gap-1 max-sm:pr-12">
            {months.map((m) => (
              <span
                key={m.key}
                className={cn(
                  "max-w-16 min-w-0 flex-1 overflow-hidden text-center font-mono text-[11px] max-sm:text-[9px]",
                  m.key === sel.key ? "text-ink" : "text-ink-faint",
                )}
              >
                {m.short}
              </span>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1">
          <span className="text-[15px] text-ink-dim">{sel.year}</span>
          <span className="mb-2 text-[32px] leading-9 font-light tracking-[-1.2px] text-white">{sel.name}</span>
          {rows.map(([label, value, color]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-3 border-b border-line-subtle py-2.5 text-sm tabular-nums"
            >
              <span className="flex items-center gap-2 text-[#a0a0a0]">
                <i className="size-1.5 rounded-full" style={{ background: color }} />
                {label}
              </span>
              <span className="font-medium text-ink">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
