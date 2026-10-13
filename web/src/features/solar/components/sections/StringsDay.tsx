import { useState } from "react";
import { hhmm } from "~/features/common/formatting/utils/date";
import { DASH, kW } from "~/features/common/formatting/utils/number";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { cn } from "~/features/common/ui/utils";
import { LineDot, ScrubChart, type ScrubLine } from "~/features/solar/components/sections/StringsChart";
import { lastIndex, nearestIndex, nextDay, type Metric, type StringDay } from "~/features/solar/utils/sections";

const METRICS: { value: Metric; label: string }[] = [
  { value: "w", label: "Power" },
  { value: "v", label: "Voltage" },
  { value: "a", label: "Current" },
];

const SUB: Record<Metric, string> = {
  w: "Each string's power every 5 minutes, from its volts and amps",
  v: "Each string's voltage every 5 minutes. It sits fairly level through the day and dips as the panels heat up.",
  a: "Each string's current every 5 minutes. It follows the sunlight on that string's panels.",
};

/** A reading in the chosen measure: "3.1 kW", "312 V", "7.6 A". */
export const reading = (m: Metric, v: number | null | undefined) =>
  v == null ? DASH : m === "w" ? kW(v) : m === "v" ? `${Math.round(v)} V` : `${v.toFixed(1)} A`;

/**
 * Each string through the day, one line each, in power, voltage or current. Moving along the chart puts that
 * moment's readings in the row above it; pointing at a string there fades the other back. With `yesterday`, its lines
 * run dashed under today's at the same time of day.
 */
export function StringsDay({
  t,
  strings,
  yesterday,
  from,
  to,
  now,
}: {
  t: number[];
  strings: StringDay[];
  yesterday: { t: number[]; strings: StringDay[] } | null;
  from: number;
  to: number;
  now: number;
}) {
  const [metric, setMetric] = useState<Metric>("w");
  const [at, setAt] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const yt = yesterday ? nextDay(yesterday.t) : [];
  const lines: ScrubLine[] = [
    ...(yesterday?.strings ?? []).map((s) => ({
      key: `y${s.n}`,
      color: s.color,
      t: yt,
      v: s[metric],
      dashed: true,
      dim: focus != null && focus !== s.n,
    })),
    ...strings.map((s) => ({ key: `s${s.n}`, color: s.color, t, v: s[metric], dim: focus != null && focus !== s.n })),
  ];
  // The moment read out: the one pointed at, else the latest reading.
  const latest = lastIndex(strings[0]?.[metric]);
  const i = at != null ? nearestIndex(t, at) : latest;
  const moment = at ?? (latest != null ? t[latest] : null);
  const yi = moment != null && yesterday ? nearestIndex(yt, moment) : null;
  const shown = strings.map((s) => ({
    s,
    today: i != null ? s[metric][i] : null,
    before: yi != null ? yesterday?.strings.find((y) => y.n === s.n)?.[metric][yi] : null,
  }));
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <TitleBlock className="min-w-0 flex-1 basis-72" title="Strings through the day" sub={SUB[metric]} />
        <Segmented label="Show each string's" options={METRICS} value={metric} onChange={setMetric} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-16 text-[13px] font-medium text-ink tabular-nums">
          {at != null ? hhmm(at) : moment != null ? (now - moment < 900 ? "Now" : hhmm(moment)) : DASH}
        </span>
        {shown.map(({ s, today, before }) => (
          <button
            key={s.n}
            type="button"
            aria-pressed={focus === s.n}
            aria-label={`String ${s.n}, ${reading(metric, today)}${yesterday ? `, ${reading(metric, before)} yesterday` : ""}`}
            onMouseEnter={() => setFocus(s.n)}
            onMouseLeave={() => setFocus(null)}
            onFocus={() => setFocus(s.n)}
            onBlur={() => setFocus(null)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border border-line-subtle bg-transparent px-3 py-1.5 text-[13px] text-ink-muted tabular-nums transition-opacity duration-200",
              focus != null && focus !== s.n && "opacity-35",
            )}
          >
            <LineDot color={s.color} />
            String {s.n}
            <span className="font-medium text-ink">{reading(metric, today)}</span>
            {yesterday && <span className="text-ink-faint">{reading(metric, before)} yesterday</span>}
          </button>
        ))}
      </div>
      <ScrubChart
        lines={lines}
        start={from}
        end={to}
        at={at}
        onAt={setAt}
        now={now >= from && now <= to ? now : undefined}
        axis={(v) => reading(metric, v)}
        label={`Each string's ${METRICS.find((m) => m.value === metric)!.label.toLowerCase()} through the day`}
        describe={(m) => {
          const k = nearestIndex(t, m);
          return [
            hhmm(m),
            ...strings.map((s) => `string ${s.n} ${reading(metric, k != null ? s[metric][k] : null)}`),
          ].join(", ");
        }}
        rest={moment ?? undefined}
      />
      {yesterday && (
        <div className="flex items-center gap-2 text-xs text-ink-faint">
          {strings.map((s) => (
            <LineDot key={s.n} color={s.color} dashed />
          ))}
          Yesterday, at the same time of day
        </div>
      )}
    </Card>
  );
}
