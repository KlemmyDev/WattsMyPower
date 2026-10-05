import { useState } from "react";
import { hourLabel, shortDay } from "~/features/common/formatting/utils/date";
import { kWh } from "~/features/common/formatting/utils/number";
import { Card } from "~/features/common/ui/components/Card";
import { ChartTooltip, TooltipRow } from "~/features/common/ui/components/ChartHover";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { Swatch } from "~/features/common/ui/components/Swatch";
import { cn } from "~/features/common/ui/utils";
import type { HomeUsage } from "~/features/home/types";
import { OTHER_COLOR, WEEKDAY_SHORT } from "~/features/home/utils";

export type Range = "today" | "week" | "month";
export const RANGES: { value: Range; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "7 days" },
  { value: "month", label: "30 days" },
];

const share = (part: number, whole: number | null) => (whole ? `${Math.round((part / whole) * 100)}%` : null);

/** A round top for the chart. */
function niceMax(v: number) {
  const step = v > 20 ? 5 : v > 5 ? 1 : v > 1 ? 0.5 : 0.1;
  return Math.max(step, Math.ceil(v / step) * step);
}

function bucketLabel(t: number, bucket: "hour" | "day") {
  const d = new Date(t * 1000);
  return bucket === "hour" ? `${hourLabel(d.getHours())}–${hourLabel((d.getHours() + 1) % 24)}` : shortDay.format(d);
}

/** Every few bars gets an axis label: each hour's 3rd, each day for a week, every 5th day for a month. */
function axisLabel(t: number, i: number, n: number, bucket: "hour" | "day") {
  const d = new Date(t * 1000);
  if (bucket === "hour") return d.getHours() % 6 === 0 ? hourLabel(d.getHours()) : null;
  if (n <= 8) return WEEKDAY_SHORT[(d.getDay() + 6) % 7];
  return i % 5 === 0 || i === n - 1 ? String(d.getDate()) : null;
}

/**
 * Where the home's power went: everything the home used, each device's part of it, and what no device measures
 * ("everything else"). The share as one bar with its key, then the same split hour by hour, or day by day.
 */
export function UsageCard({
  usage,
  colors,
  range,
  onRange,
}: {
  usage: HomeUsage | undefined;
  colors: Map<number, string>;
  range: Range;
  onRange: (r: Range) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const devices = (usage?.devices ?? []).filter((d) => colors.has(d.id));
  const total = usage?.total;
  const parts = [
    ...devices.map((d) => ({ id: d.id, label: d.name, kwh: d.total, color: colors.get(d.id)! })),
    ...(total?.other != null ? [{ id: 0, label: "Everything else", kwh: total.other, color: OTHER_COLOR }] : []),
  ];
  const whole = total?.home ?? null;
  const sum = parts.reduce((a, p) => a + p.kwh, 0);

  return (
    <Card aria-labelledby="h-usage" className="col-span-12 gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="h-usage">Where your power went</h2>
          <span className="text-[13px] text-ink-muted">
            What your home used, from the inverter, and what each connected device used of it
          </span>
        </div>
        <Segmented label="Period" options={RANGES} value={range} onChange={onRange} />
      </div>

      {!usage ? (
        <Skeleton className="h-[300px]" />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <div className="flex flex-col gap-1">
              <span className="text-[13px] text-ink-muted">Used at home</span>
              <span className="text-[40px] leading-11 font-light tracking-[-1.5px] tabular-nums">
                {whole != null ? kWh(whole) : "—"}
              </span>
            </div>
            <div className="flex flex-col gap-1 pb-1.5 text-sm text-ink-muted tabular-nums">
              <span>
                <b className="font-semibold text-ink">{kWh(total?.measured ?? 0)}</b> measured by your devices
                {whole ? ` (${share(total?.measured ?? 0, whole)})` : ""}
              </span>
              {whole == null && <span>No inverter readings in this period, so only what the devices measured</span>}
            </div>
          </div>

          {sum > 0 && (
            <div className="flex flex-col gap-3">
              <div
                className="flex h-3 gap-[2px] overflow-hidden rounded-full"
                role="img"
                aria-label="Share of home use"
              >
                {parts
                  .filter((p) => p.kwh > 0)
                  .map((p) => (
                    <span key={p.id} style={{ flexGrow: p.kwh, background: p.color }} className="min-w-[3px]" />
                  ))}
              </div>
              <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-6 gap-y-2 p-0">
                {parts.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 text-sm tabular-nums">
                    <Swatch color={p.color} size={10} />
                    <span className="min-w-0 flex-1 truncate text-ink-muted">{p.label}</span>
                    <span className="font-medium">{kWh(p.kwh)}</span>
                    <span className="w-10 text-right text-ink-faint">{share(p.kwh, whole) ?? ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Bars usage={usage} devices={devices} colors={colors} hover={hover} setHover={setHover} />
        </>
      )}
    </Card>
  );
}

function Bars({
  usage,
  devices,
  colors,
  hover,
  setHover,
}: {
  usage: HomeUsage;
  devices: HomeUsage["devices"];
  colors: Map<number, string>;
  hover: number | null;
  setHover: (i: number | null) => void;
}) {
  const [width, setWidth] = useState(0);
  const n = usage.t.length;
  const height = (i: number) =>
    Math.max(usage.home[i] ?? 0, devices.reduce((a, d) => a + d.kwh[i], 0) + (usage.other[i] ?? 0));
  const top = niceMax(Math.max(0, ...usage.t.map((_, i) => height(i))));
  const pc = (v: number) => `${Math.max(0, (v / top) * 100)}%`;
  const h = hover != null ? hover : null;

  return (
    <div className="flex flex-col gap-2">
      <div
        // Layout px, as the tooltip is placed in.
        onPointerEnter={(e) => setWidth(e.currentTarget.offsetWidth)}
        onFocus={(e) => setWidth(e.currentTarget.offsetWidth)}
        className="relative flex h-[220px] items-end gap-[3px] pr-12 max-sm:h-[180px] max-sm:gap-[2px] max-sm:pr-10"
        onMouseLeave={() => setHover(null)}
      >
        {[1, 0.5].map((q) => (
          <div
            key={q}
            className="pointer-events-none absolute inset-x-0 border-t border-fg/5"
            style={{ top: `${(1 - q) * 100}%` }}
          >
            <span className="absolute -top-[7px] right-0 font-mono text-[10px] leading-[14px] text-ink-faint">
              {kWh(top * q)}
            </span>
          </div>
        ))}
        {usage.t.map((t, i) => {
          const label = bucketLabel(t, usage.bucket);
          return (
            <button
              key={t}
              type="button"
              aria-label={`${label}: ${usage.home[i] != null ? `${kWh(usage.home[i])} used` : "no inverter readings"}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className={cn(
                "flex h-full min-w-0 flex-1 cursor-default flex-col-reverse gap-[2px] rounded-t-[4px] border-0 bg-transparent p-0",
                h != null && h !== i && "opacity-60",
              )}
            >
              {devices.map((d) =>
                d.kwh[i] > 0 ? (
                  <span
                    key={d.id}
                    className="w-full flex-none first:rounded-b-none last:rounded-t-[4px]"
                    style={{ height: pc(d.kwh[i]), background: colors.get(d.id) }}
                  />
                ) : null,
              )}
              {(usage.other[i] ?? 0) > 0 && (
                <span
                  className="w-full flex-none rounded-t-[4px]"
                  style={{ height: pc(usage.other[i]!), background: OTHER_COLOR }}
                />
              )}
            </button>
          );
        })}
        {h != null && (
          <ChartTooltip left={((h + 0.5) / n) * 100} flip={h > n / 2} width={width}>
            <div className="font-semibold text-ink">{bucketLabel(usage.t[h], usage.bucket)}</div>
            {devices
              .filter((d) => d.kwh[h] > 0)
              .map((d) => (
                <TooltipRow key={d.id} label={d.name} value={kWh(d.kwh[h])} color={colors.get(d.id)} />
              ))}
            {usage.other[h] != null && (
              <TooltipRow label="Everything else" value={kWh(usage.other[h])} color={OTHER_COLOR} />
            )}
            <TooltipRow label="Used at home" value={usage.home[h] != null ? kWh(usage.home[h]) : "—"} />
          </ChartTooltip>
        )}
      </div>
      <div className="flex gap-[3px] pr-12 font-mono text-[10px] text-ink-faint max-sm:gap-[2px] max-sm:pr-10">
        {usage.t.map((t, i) => (
          <span key={t} className="min-w-0 flex-1 overflow-visible text-center whitespace-nowrap">
            {axisLabel(t, i, n, usage.bucket) ?? ""}
          </span>
        ))}
      </div>
    </div>
  );
}
