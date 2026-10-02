import type { Bills } from "~/features/bills/types";
import { barScale, billAmount, spanAxis, spanLabel } from "~/features/bills/utils";
import { Key } from "~/features/bills/components/BillParts";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Swatch } from "~/features/common/ui/components/Swatch";
import { dollars } from "~/features/common/formatting/utils/number";

type Kind = "past" | "current" | "upcoming";

/** Past bills, this one, and the next few estimated, as bars that drop below the line for a credit. */
export function BillsOverTime({ bills }: { bills: Bills | undefined }) {
  if (!bills) return null;
  const cur = bills.current.expected ?? bills.current.so_far;
  const series = [
    ...bills.past.map((p) => ({
      span: p,
      v: p.net_cost,
      kind: "past" as Kind,
      note: p.recorded < p.days ? ` (${p.recorded} of ${p.days} days recorded)` : "",
    })),
    {
      span: bills.period,
      v: cur.net_cost,
      kind: "current" as Kind,
      note: bills.current.expected ? " (expected)" : " (so far)",
    },
    ...bills.upcoming.flatMap((u) =>
      u ? [{ span: u, v: u.net_cost, kind: "upcoming" as Kind, note: " (estimated)" }] : [],
    ),
  ];
  const sc = barScale(
    series.map((s) => s.v),
    12,
    series.some((s) => s.v < 0) ? 12 : 4,
  );
  return (
    <Card aria-labelledby="h-over-time">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <TitleBlock
          id="h-over-time"
          title="Bills over time"
          sub="Past bills use your inverter data and current rates, so they may differ slightly from what your retailer charged"
        />
        <div className="flex flex-wrap gap-4 text-xs text-ink-muted">
          <Key swatch={<Swatch color="#3a3a3e" size={10} />}>Past bills</Key>
          <Key swatch={<Swatch color="#f5f5f5" size={10} />}>This bill</Key>
          <Key swatch={<i className="size-2.5 rounded-xs border border-dashed border-white/50" />}>Estimated</Key>
          <Key swatch={<Swatch color="rgba(62,224,143,0.5)" size={10} />}>Credit</Key>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="relative flex h-60 gap-2" role="img" aria-label="Bills over time">
          <div className="absolute inset-x-0 h-px bg-white/14" style={{ top: `${sc.zero.toFixed(2)}%` }} />
          {series.map((s) => {
            const { top, height } = sc.bar(s.v);
            const neg = s.v < 0;
            const fill =
              s.kind === "upcoming"
                ? "transparent"
                : s.kind === "current"
                  ? neg
                    ? "#3ee08f"
                    : "#f5f5f5"
                  : neg
                    ? "rgba(62,224,143,0.5)"
                    : "#3a3a3e";
            return (
              <div
                key={s.span.start}
                title={`${spanLabel(s.span)}: ${billAmount(s.v)}${s.note}`}
                className="relative min-w-0 flex-1"
              >
                <div
                  className="absolute inset-x-[12%] rounded-md"
                  style={{
                    top: `${top.toFixed(2)}%`,
                    height: `${height.toFixed(2)}%`,
                    background: fill,
                    border:
                      s.kind === "upcoming"
                        ? `1px dashed ${neg ? "rgba(62,224,143,0.7)" : "rgba(255,255,255,0.45)"}`
                        : 0,
                  }}
                />
                <span
                  className={`absolute -inset-x-1 text-center text-[11px] font-semibold whitespace-nowrap tabular-nums ${s.kind === "current" ? "text-ink" : "text-ink-faint"}`}
                  style={{ top: neg ? `calc(${(top + height).toFixed(2)}% + 4px)` : `calc(${top.toFixed(2)}% - 18px)` }}
                >
                  {dollars(s.v)}
                </span>
              </div>
            );
          })}
        </div>
        <div className="flex gap-2">
          {series.map((s) => (
            <span
              key={s.span.start}
              className={`min-w-0 flex-1 truncate text-center font-mono text-[11px] ${s.kind === "current" ? "text-ink" : "text-ink-faint"}`}
            >
              {spanAxis(s.span, bills.months)}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}
