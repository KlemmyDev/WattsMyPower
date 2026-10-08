import type { CSSProperties } from "react";
import { kWh, pct } from "~/features/common/formatting/utils/number";
import { alpha } from "~/features/common/theme/utils/colors";
import { useBarHover } from "~/features/common/ui/components/ChartHover";
import { cn } from "~/features/common/ui/utils";

export type BreakdownPart = { key: string; label: string; kwh: number; color: string };

/**
 * Energy split into its parts: a bar, and a line for each part below with its share of `total` and kWh. The part under
 * the pointer, on the bar or its line, lifts and lights up; the rest fade back.
 */
export function Breakdown({ parts, total }: { parts: BreakdownPart[]; total: number }) {
  const { hover, plot, bar } = useBarHover<string>();
  const lit = (key: string) => hover == null || hover === key;
  return (
    <div className="flex flex-col gap-4" {...plot}>
      <div className="flex h-3 gap-0.5">
        {parts
          .filter((x) => x.kwh > 0.005)
          .map((x) => (
            <span
              key={x.key}
              aria-hidden
              {...bar(x.key)}
              className={cn(
                "h-full transition-[flex-grow,opacity,scale] duration-300 ease-out-soft first:rounded-l-full last:rounded-r-full",
                !lit(x.key) && "opacity-30",
                hover === x.key && "scale-y-150",
              )}
              style={{ flexGrow: x.kwh, background: x.color } as CSSProperties}
            />
          ))}
      </div>
      <ul className="-mx-2.5 flex flex-col">
        {parts.map((x) => (
          <li
            key={x.key}
            tabIndex={0}
            {...bar(x.key)}
            className={cn(
              "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1 text-[13.5px] transition-[background-color,opacity] duration-200 outline-none",
              hover === x.key && "bg-fg/5",
              !lit(x.key) && "opacity-55",
            )}
          >
            <i
              aria-hidden
              className="size-2 rounded-full transition-shadow duration-200"
              style={{
                background: x.color,
                boxShadow: hover === x.key ? `0 0 0 3px ${alpha(x.color, 0.25)}` : undefined,
              }}
            />
            <span className={cn("flex-1 transition-colors", hover === x.key ? "text-ink" : "text-ink-soft")}>
              {x.label}
            </span>
            <span className="text-ink-faint tabular-nums">{pct((x.kwh / total) * 100)}</span>
            <span className="w-16 text-right text-ink tabular-nums">{kWh(x.kwh)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
