import { type ReactNode, useMemo, useState } from "react";
import type { BillDay, Bills } from "~/features/bills/types";
import type { Tariff } from "~/features/common/tariffs/types";
import { billCents } from "~/features/bills/utils";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Card, Muted, TitleBlock } from "~/features/common/ui/components/Card";
import { DataRow } from "~/features/common/ui/components/DataRow";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { cn } from "~/features/common/ui/utils";
import { billHeatColor, COLOR, heatColor, rampColor } from "~/features/common/theme/utils/colors";
import { bandColor, bandHours, usedBands } from "~/features/common/tariffs/utils";
import { kWh, kWhInt, money, plural } from "~/features/common/formatting/utils/number";
import { addDays, dateKey, fromDateKey, mondayFirst, partsOf } from "~/features/common/time/utils";
import { dayMonth, fullDate, monthShort, parseYmd } from "~/features/common/formatting/utils/date";

type MetricKey = "cost" | "imp" | "exp" | "pv" | "peak";
type Metric = {
  key: MetricKey;
  /** "Cost", "From the grid": the tab, and the summary line. */
  label: string;
  /** The tab's dot, and the colour of the most. */
  color: string;
  /** The colour of the least, for a scale that starts at grey rather than fading into the cell. */
  from?: string;
  value: (d: BillDay) => number | null;
  format: (v: number) => string;
};

/** The selected day: a canvas-coloured gap, then a full-contrast ring (as on History). */
const RING = "shadow-[0_0_0_2px_var(--color-canvas),0_0_0_3.5px_var(--color-fg)]";
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const shade = (m: Metric, v: number) => (m.from ? rampColor(m.from, m.color, v) : heatColor(m.color, v));

/** The dearest rate that's used, on time of use: its use gets a colour of its own. */
function peakBand(tariff: Tariff | undefined): number | null {
  if (tariff?.type !== "tou") return null;
  const used = [...usedBands(tariff)];
  if (used.length < 2) return null;
  return used.reduce((a, b) => (Number(tariff.bands[b]?.rate) > Number(tariff.bands[a]?.rate) ? b : a));
}

function metricsFor(bills: Bills, peak: number | null): Metric[] {
  const out: Metric[] = [
    { key: "cost", label: "Cost", color: COLOR.bad, value: (d) => d.net_cost, format: billCents },
    { key: "imp", label: "From the grid", color: COLOR.import, value: (d) => d.import_kwh, format: kWh },
    {
      key: "exp",
      label: "Sent to the grid",
      color: COLOR.solar,
      from: COLOR.bar,
      value: (d) => d.export_kwh,
      format: kWh,
    },
    { key: "pv", label: "Solar", color: COLOR.solar, from: COLOR.bar, value: (d) => d.pv_kwh, format: kWh },
  ];
  if (peak != null)
    out.splice(2, 0, {
      key: "peak",
      label: `${bills.bands[peak]?.name ?? "Peak"} use`,
      color: COLOR.lilac, // not the rate's own colour: on peak that's the same as Solar's
      value: (d) => d.bands[peak]?.import_kwh ?? null,
      format: kWh,
    });
  return out;
}

type Cell =
  | { kind: "pad" }
  | { kind: "day"; key: string; date: number; day: BillDay }
  | { kind: "ahead"; key: string; date: number; expected: number | null }
  | { kind: "none"; key: string; date: number };

/**
 * This billing period as a calendar, a week to a row, each day coloured by what it cost (or its grid
 * use, feed-in, solar, or peak-rate use). Select a day to see what made up its cost.
 */
export function PeriodCalendar({ bills, tariff }: { bills: Bills; tariff: Tariff | undefined }) {
  const peak = peakBand(tariff);
  const metrics = useMemo(() => metricsFor(bills, peak), [bills, peak]);
  const [metricKey, setMetricKey] = useState<MetricKey>("cost");
  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0];
  const { period, days, ahead } = bills;

  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const whole = useMemo(() => days.filter((d) => !d.partial), [days]);
  const [picked, setPicked] = useState<string | null>(null);
  const selectedKey = picked && byDate.has(picked) ? picked : days[days.length - 1]?.date;
  const selected = selectedKey ? byDate.get(selectedKey) : undefined;

  const rows = useMemo(() => {
    const expected = new Map(ahead.map((a) => [a.date, a.net_cost]));
    const start = fromDateKey(period.start);
    const lead = mondayFirst(start);
    const cells: Cell[] = Array.from({ length: lead }, () => ({ kind: "pad" }));
    const last = days[days.length - 1]?.date ?? "";
    for (let k = 0; k < period.days; k++) {
      const date = addDays(start, k);
      const key = dateKey(date);
      const day = byDate.get(key);
      if (day) cells.push({ kind: "day", key, date, day });
      else if (key > last) cells.push({ kind: "ahead", key, date, expected: expected.get(key) ?? null });
      else cells.push({ kind: "none", key, date });
    }
    while (cells.length % 7) cells.push({ kind: "pad" });
    return Array.from({ length: cells.length / 7 }, (_, r) => cells.slice(r * 7, r * 7 + 7));
  }, [period, days, ahead, byDate]);

  // Colour by where each day sits between nothing and the period's most (whole days, so today's
  // partial figures don't set the scale). Cost runs one scale from green, in credit, to red, owed,
  // both sides measured against the bigger of the two so a small bill doesn't look like a big one.
  const vals = whole.map(metric.value).filter((v): v is number => v != null);
  const hi = Math.max(0, ...vals) || 1;
  const swing = Math.max(0, ...vals.map(Math.abs)) || 1;
  const fill = (v: number | null) => {
    if (v == null) return null;
    if (metric.key === "cost") {
      const n = Math.max(-1, Math.min(1, v / swing));
      return { color: billHeatColor(n), strong: Math.abs(n) > 0.55 };
    }
    const n = Math.min(1, v / hi);
    return { color: shade(metric, n), strong: n > 0.55 };
  };

  // Added up at full precision and rounded once, so the cost comes to the bill so far. Days are at the rates
  // alone, though: with a discount or credits the bill takes those off too, and the total says so.
  const recorded = days.map(metric.value).filter((v): v is number => v != null);
  const total = recorded.reduce((a, v) => a + v, 0);
  const { discount, credits } = bills.current.so_far;
  const before =
    metric.key !== "cost" || (discount <= 0 && credits <= 0)
      ? ""
      : ` before ${discount > 0 && credits > 0 ? "discount and credits" : discount > 0 ? "discount" : "credits"}`;
  const avgOf = (f: (d: BillDay) => number | null) => {
    const v = whole.map(f).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null;
  };
  const avg = avgOf(metric.value);
  const avgCost = avgOf((d) => d.net_cost);

  const standouts = whole.length
    ? [
        { title: "Costliest day", color: COLOR.bad, d: whole.reduce((a, b) => (b.net_cost > a.net_cost ? b : a)), v: (d: BillDay) => billCents(d.net_cost) },
        { title: "Most sent to the grid", color: COLOR.solar, d: whole.reduce((a, b) => (b.export_kwh > a.export_kwh ? b : a)), v: (d: BillDay) => kWhInt(d.export_kwh) },
        { title: "Cheapest day", color: COLOR.good, d: whole.reduce((a, b) => (b.net_cost < a.net_cost ? b : a)), v: (d: BillDay) => billCents(d.net_cost) },
      ].filter((s, i) => i !== 1 || s.d.export_kwh >= 0.1) // prettier-ignore
    : [];

  return (
    <Card aria-labelledby="h-period">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <TitleBlock
          id="h-period"
          title="This billing period, day by day"
          sub={
            recorded.length
              ? `${metric.label}: ${metric.format(total)} over ${days.length} ${plural(days.length, "day")}${before}${avg != null ? ` · ${metric.format(avg)} on an average day` : ""}`
              : "Fills in from the first day of readings"
          }
        />
        <Segmented
          role="tablist"
          label="Colour days by"
          value={metric.key}
          onChange={setMetricKey}
          className="max-w-full [scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden"
          buttonClassName="max-sm:px-3"
          options={metrics.map((m) => ({
            value: m.key,
            label: (
              <>
                <i className="size-[7px] rounded-full" style={{ background: m.color }} />
                {m.label}
              </>
            ),
          }))}
        />
      </div>

      <div className="flex flex-wrap items-start gap-x-8 gap-y-6">
        <div className="flex min-w-0 flex-[3_1_420px] flex-col gap-3">
          <div className="grid grid-cols-[32px_repeat(7,minmax(0,1fr))] gap-1.5 max-sm:grid-cols-[24px_repeat(7,minmax(0,1fr))] max-sm:gap-1">
            <span />
            {WEEKDAYS.map((w, i) => (
              <span key={i} className="text-center font-mono text-[11px] text-ink-faint">
                {w}
              </span>
            ))}
            {rows.map((row, r) => {
              const first = row.find((c) => c.kind !== "pad") as Exclude<Cell, { kind: "pad" }> | undefined;
              const newMonth = row.find((c) => c.kind !== "pad" && partsOf(c.date).day === 1) as
                Exclude<Cell, { kind: "pad" }> | undefined;
              const month = r === 0 ? first : newMonth;
              return (
                <Row key={r} month={month ? monthShort.format(month.date * 1000) : ""}>
                  {row.map((c, i) => (
                    <DayCell
                      key={i}
                      cell={c}
                      metric={metric}
                      fill={c.kind === "day" ? fill(metric.value(c.day)) : null}
                      selected={c.kind === "day" && c.key === selectedKey}
                      onSelect={setPicked}
                    />
                  ))}
                </Row>
              );
            })}
          </div>
          <Legend metric={metric} />
        </div>

        <div className="flex min-w-0 flex-[2_1_280px] flex-col gap-5">
          {selected ? (
            <DayDetail day={selected} bills={bills} tariff={tariff} avgCost={avgCost} />
          ) : (
            <Muted>Select a day to see what it cost.</Muted>
          )}
        </div>
      </div>

      {standouts.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          {standouts.map((s) => (
            <button
              key={s.title}
              type="button"
              onClick={() => setPicked(s.d.date)}
              aria-pressed={s.d.date === selectedKey}
              className={cn(
                "flex min-w-0 flex-col gap-1 rounded-2xl border bg-canvas/40 px-4 py-3 text-left transition-colors duration-200 hover:border-fg/25",
                s.d.date === selectedKey ? "border-fg/30" : "border-line-subtle",
              )}
            >
              <span className="flex items-center gap-2 text-xs text-ink-dim">
                <i className="size-1.5 flex-none rounded-full" style={{ background: s.color }} />
                {s.title}
              </span>
              <span className="text-xl font-light tracking-[-0.5px] text-fg tabular-nums">{s.v(s.d)}</span>
              <span className="text-xs text-ink-label">{dayMonth(fromDateKey(s.d.date))}</span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function Row({ month, children }: { month: string; children: ReactNode }) {
  return (
    <>
      <span className="self-center font-mono text-[11px] text-ink-label">{month}</span>
      {children}
    </>
  );
}

function DayCell({
  cell,
  metric,
  fill,
  selected,
  onSelect,
}: {
  cell: Cell;
  metric: Metric;
  fill: { color: string; strong: boolean } | null;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const base =
    "relative flex h-11 items-start rounded-lg p-1.5 font-mono text-[11px] leading-none max-sm:h-10 max-sm:p-1";
  if (cell.kind === "pad") return <span />;
  const label = dayMonth(cell.date);
  if (cell.kind === "ahead")
    return (
      <span
        className={cn(base, "border border-dashed border-fg/15 text-ink-faint")}
        title={`${label}: still to come${cell.expected != null ? `, expected about ${billCents(cell.expected)}` : ""}`}
      >
        {partsOf(cell.date).day}
      </span>
    );
  if (cell.kind === "none")
    return (
      <span className={cn(base, "text-ink-faint inset-ring inset-ring-fg/6")} title={`${label}: no readings`}>
        {partsOf(cell.date).day}
      </span>
    );
  const v = metric.value(cell.day);
  const text = `${label}${cell.day.partial ? " so far" : ""}: ${v == null ? "no figure" : metric.format(v)}`;
  return (
    <button
      type="button"
      title={text}
      aria-label={text}
      aria-pressed={selected}
      onClick={() => onSelect(cell.key)}
      className={cn(
        base,
        "border-0 text-left transition-[background] duration-240 ease-[ease]",
        fill?.strong ? "text-canvas" : "text-ink-muted",
        !fill && "bg-transparent inset-ring inset-ring-fg/10",
        selected && cn("z-1", RING),
      )}
      style={fill ? { background: fill.color } : undefined}
    >
      {partsOf(cell.date).day}
      {cell.day.partial && (
        <i
          className="absolute right-1.5 bottom-1.5 size-1.5 rounded-full bg-current"
          aria-hidden
          title="Today so far"
        />
      )}
    </button>
  );
}

function Legend({ metric }: { metric: Metric }) {
  return (
    <div className="ml-[38px] flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-dim max-sm:ml-0">
      {metric.key === "cost" ? (
        <span className="flex items-center gap-1.5">
          In credit
          {[-1, -0.6, -0.2, 0.2, 0.6, 1].map((v) => (
            <i key={v} className="size-3 rounded-[3px]" style={{ background: billHeatColor(v) }} />
          ))}
          Owed
        </span>
      ) : (
        <span className="flex items-center gap-1.5">
          Less
          {[0, 0.25, 0.5, 0.75, 1].map((v) => (
            <i key={v} className="size-3 rounded-[3px]" style={{ background: shade(metric, v) }} />
          ))}
          More
        </span>
      )}
      <span className="flex items-center gap-1.5">
        <i className="size-3 rounded-[3px] border border-dashed border-fg/25" />
        Still to come
      </span>
    </div>
  );
}

/** One day's bill: grid use (by rate, on time of use), supply, and feed-in, against the period's average day. */
function DayDetail({
  day,
  bills,
  tariff,
  avgCost,
}: {
  day: BillDay;
  bills: Bills;
  tariff: Tariff | undefined;
  avgCost: number | null;
}) {
  const tou = tariff?.type === "tou" ? tariff : null;
  const diff = avgCost != null && !day.partial ? day.net_cost - avgCost : null;
  const rates = bills.bands
    .map((b, i) => ({ ...b, ...day.bands[i], i }))
    .filter((b) => b.import_kwh > 0.005 || b.cost > 0.005);
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[11px] tracking-[1.2px] text-ink-faint uppercase">
          {fullDate.format(parseYmd(day.date))}
          {day.partial ? " · so far" : ""}
        </span>
        <span className="text-[44px] leading-12 font-light tracking-[-1.8px] tabular-nums">
          {billCents(day.net_cost)}
        </span>
        <Muted>
          {day.partial
            ? "Today's bill so far. It fills in through the day."
            : diff == null
              ? "What this day added to the bill."
              : Math.abs(diff) < 0.05
                ? "About the same as your average day this period."
                : `${money(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than your average day this period (${billCents(avgCost!)}).`}
        </Muted>
      </div>
      <div>
        {tou && rates.length ? (
          rates.map((b) => (
            <DataRow
              key={b.i}
              label={
                <span className="flex items-center gap-2">
                  <i className="size-2 flex-none rounded-full" style={{ background: bandColor(b.i) }} />
                  <span>
                    {b.name} · {kWh(b.import_kwh)}
                    <span className="block text-xs text-ink-faint">
                      {tou.bands[b.i] ? bandHours(tou.bands[b.i]) : ""}
                    </span>
                  </span>
                </span>
              }
            >
              {money(b.cost)}
            </DataRow>
          ))
        ) : (
          <DataRow label={`Grid usage · ${kWh(day.import_kwh)}`}>{money(day.import_cost)}</DataRow>
        )}
        <DataRow label="Supply charge">{money(day.supply)}</DataRow>
        <DataRow label={`Feed-in credit · ${kWh(day.export_kwh)} sent`}>
          {money(day.feed_in_credit ? -day.feed_in_credit : 0)}
        </DataRow>
        <DataRow label={day.partial ? "So far" : "Day's total"} total>
          {billCents(day.net_cost)}
        </DataRow>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-ink-muted">
        <span>
          {day.pv_kwh != null ? `${kWh(day.pv_kwh)} of solar · ` : ""}
          {kWh(day.home_kwh)} used at home
          {day.source === "meter" ? " · grid figures from your smart meter" : ""}
        </span>
        <ButtonLink to="/history" search={{ day: day.date }} variant="link" size="sm">
          See it hour by hour
        </ButtonLink>
      </div>
    </>
  );
}
