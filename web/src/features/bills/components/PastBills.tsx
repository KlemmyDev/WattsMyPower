import { useState } from "react";
import type { Basis, Bills, BillSpan, BillTotals } from "~/features/bills/types";
import { barScale, basisNote, billAmount, billSpread, spanAxis, spanLabel } from "~/features/bills/utils";
import { DASH, dollars, kWhInt, money } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { useBarHover } from "~/features/common/ui/components/ChartHover";
import { cn } from "~/features/common/ui/utils";

type Entry = BillSpan &
  BillTotals & {
    kind: "past" | "current" | "upcoming";
    /** Past: days with readings; the rest weren't counted. */
    recorded?: number;
    basis?: Basis;
    /** This bill: what it's come to so far, under where it's heading. */
    soFar?: number;
  };

/** Every bill there's a figure for, oldest first: the past ones, this one (where it's heading), and the next few. */
function entries(bills: Bills): Entry[] {
  const cur = bills.current.expected ?? bills.current.so_far;
  return [
    ...bills.past.map((p) => ({ ...p, kind: "past" as const })),
    { ...bills.period, ...cur, kind: "current" as const, soFar: bills.current.so_far.net_cost },
    ...bills.upcoming.flatMap((u) => (u ? [{ ...u, kind: "upcoming" as const }] : [])),
  ];
}

/**
 * Your bills, past, this one and the next few estimated, as a strip of bars (below the line for a credit), with the
 * year ahead and what solar and the battery save in it beside the title. Hover, tap or select a bill to see what made
 * it up underneath; this one shows until you do.
 */
export function PastBills({ bills, className }: { bills: Bills; className?: string }) {
  const list = entries(bills);
  const current = list.findIndex((e) => e.kind === "current");
  const { hover, plot, bar } = useBarHover();
  const [picked, setPicked] = useState<number | null>(null);
  const shown = list[hover ?? picked ?? current];
  const sc = barScale(
    list.map((e) => e.net_cost),
    16,
    list.some((e) => e.net_cost < 0) ? 16 : 2,
  );
  const last = bills.past.at(-1);
  const ny = bills.next_year;
  const figures: [string, string][] = [
    ["Next 12 months", ny ? `about ${billAmount(ny.net_cost)}` : DASH],
    ["Saved in them", ny ? dollars(ny.without_solar - ny.net_cost) : DASH],
  ];
  return (
    <Card aria-labelledby="h-bills" className={className}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <TitleBlock
          id="h-bills"
          title="Your bills"
          sub={[
            last && `Last bill ${billAmount(last.net_cost)}`,
            `${bills.current.expected ? "This one about" : "This one so far"} ${billAmount(list[current].net_cost)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
        <dl className="flex flex-wrap gap-x-7 gap-y-2">
          {figures.map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <dt className="text-[11.5px] text-ink-faint">{k}</dt>
              <dd className="text-[17px] font-light tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="relative flex h-32 gap-2" {...plot}>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-t border-line-subtle"
            style={{ top: `${sc.zero}%` }}
          />
          {list.map((e, i) => {
            const { top, height } = sc.bar(e.net_cost);
            const neg = e.net_cost < 0;
            const on = shown === e;
            return (
              <button
                key={e.start}
                type="button"
                {...bar(i)}
                onClick={() => setPicked(i)}
                aria-pressed={on}
                aria-label={`${spanLabel(e)}: ${billAmount(e.net_cost)}${note(e)}`}
                className={cn(
                  "relative min-w-0 flex-1 border-0 bg-transparent p-0 transition-opacity duration-200",
                  !on && "opacity-55 hover:opacity-80",
                )}
              >
                <i
                  className="absolute inset-x-[14%] rounded-md"
                  style={{
                    top: `${top}%`,
                    height: `${height}%`,
                    background:
                      e.kind === "upcoming"
                        ? "transparent"
                        : neg
                          ? COLOR.good
                          : e.kind === "current"
                            ? COLOR.ink
                            : COLOR.bar,
                    border: e.kind === "upcoming" ? `1px dashed ${alpha(neg ? COLOR.good : COLOR.fg, 0.5)}` : 0,
                    opacity: e.kind === "current" && e.soFar != null ? 0.35 : 1,
                  }}
                />
                {/* This bill so far, solid, inside where it's heading. */}
                {e.kind === "current" && e.soFar != null && e.soFar > 0 && !neg && (
                  <i
                    className="absolute inset-x-[14%] rounded-md bg-ink"
                    style={{ top: `${sc.y(e.soFar)}%`, height: `${sc.zero - sc.y(e.soFar)}%` }}
                  />
                )}
                <span
                  className="absolute -inset-x-1 text-center text-[11px] whitespace-nowrap text-ink-muted tabular-nums"
                  style={{ top: neg ? `calc(${top + height}% + 3px)` : `calc(${top}% - 16px)` }}
                >
                  {dollars(e.net_cost)}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          {list.map((e) => (
            <span
              key={e.start}
              className={cn(
                "min-w-0 flex-1 truncate text-center font-mono text-[11px]",
                shown === e ? "text-ink" : "text-ink-faint",
              )}
            >
              {e.kind === "current" ? "This bill" : spanAxis(e, bills.months)}
            </span>
          ))}
        </div>
      </div>
      {shown && <BillDetail e={shown} />}
    </Card>
  );
}

/** What a past bill's figure is short of, or where an estimate came from, for a bar's label. */
function note(e: Entry): string {
  if (e.kind === "current") return ", expected";
  if (e.kind === "upcoming") return ", estimated";
  return e.recorded != null && e.recorded < e.days ? `, ${e.recorded} of ${e.days} days recorded` : "";
}

/** One bill, opened up: its dates and total, then what was bought, the feed-in credit, the supply and what was saved. */
function BillDetail({ e }: { e: Entry }) {
  const status =
    e.kind === "current"
      ? "This bill, where it's heading"
      : e.kind === "upcoming"
        ? `Estimated, likely ${dollars(e.net_cost - billSpread(e.net_cost))} to ${dollars(e.net_cost + billSpread(e.net_cost))}`
        : e.recorded != null && e.recorded < e.days
          ? `${e.recorded} of ${e.days} days recorded`
          : "At today's rates";
  const stats: [string, string, string][] = [
    ["Bought", money(e.import_cost), `${kWhInt(e.import_kwh)} in`],
    ["Feed-in credit", money(e.feed_in_credit ? -e.feed_in_credit : 0), `${kWhInt(e.export_kwh)} sent out`],
    ["Supply", money(e.supply), `${e.days} days`],
    [
      "Saved",
      dollars(Math.max(0, Math.round(e.without_solar) - Math.round(e.net_cost))),
      `On ${dollars(e.without_solar)} grid only`,
    ],
  ];
  return (
    <div className="flex flex-col gap-3 border-t border-line-subtle pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <span className="text-[15px] font-medium text-ink">{spanLabel(e)}</span>
        <span className="text-[13px] text-ink-muted tabular-nums">
          {status} · <span className={cn("text-ink", e.net_cost < 0 && "text-good")}>{billAmount(e.net_cost)}</span>
        </span>
      </div>
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(124px,1fr))] gap-x-6 gap-y-3">
        {stats.map(([k, v, sub]) => (
          <div key={k} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs text-ink-faint">{k}</dt>
            <dd className="text-[17px] font-light whitespace-nowrap tabular-nums">{v}</dd>
            <dd className="truncate text-[11.5px] text-ink-faint">{sub}</dd>
          </div>
        ))}
      </dl>
      {e.kind === "upcoming" && e.basis !== undefined && (
        <span className="text-xs text-ink-faint">{basisNote(e.basis)}.</span>
      )}
      {e.kind === "past" && (
        <span className="text-xs text-ink-faint">
          It can differ a little from what your retailer charged, from the meter's readings and any rate changes.
        </span>
      )}
    </div>
  );
}
