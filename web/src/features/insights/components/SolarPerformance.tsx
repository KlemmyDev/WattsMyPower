import type { Insights } from "~/features/insights/types";
import { Card, Eyebrow, Footnote, TitleBlock } from "~/features/common/ui/components/Card";
import { cn } from "~/features/common/ui/utils";
import { DASH, kWh, pct } from "~/features/common/formatting/utils/number";
import { listDays, monthShort, parseYmd, shortDay } from "~/features/common/formatting/utils/date";
import { Figure } from "~/features/insights/components/Kpis";

type Performance = NonNullable<Insights["performance"]>;
type Day = Performance["days"][number];
type Rated = Day & { ratio: number };
type Tone = "warn" | "ok" | "wait";

const dayLabel = (d: Day) => {
  const x = parseYmd(d.date);
  return `${x.getDate()} ${monthShort.format(x)}`;
};

/** A clear day more than 10% under what the weather allowed. */
const isLow = (d: Day) => d.clear && d.ratio != null && d.ratio < 0.9;

function performanceNote(P: Insights["performance"], rated: Rated[]): { tone: Tone; note: string } {
  if (!P)
    return {
      tone: "wait",
      note: "Past weather is unavailable right now, so solar output can't be compared with what the weather allowed. The server could not reach Open-Meteo.",
    };
  if (P.fitted_hours < 24 || !rated.length)
    return {
      tone: "wait",
      note: "Learning what your panels should produce for the weather. This needs a few days of daylight readings.",
    };
  const lows = rated.filter(isLow).map((d) => d.date);
  if (!lows.length)
    return { tone: "ok", note: "Output has been within 10% of expected on every clear day with readings." };
  const when =
    lows.length <= 4
      ? `on ${listDays(lows)}, ${lows.length === 1 ? "a clear day" : "all clear days"}`
      : `on ${lows.length} clear days in the last 30, most recently ${listDays(lows.slice(-1))}`;
  return {
    tone: "warn",
    note: `Output was more than 10% below expected ${when}. Dust, bird droppings, or new shading are common causes. Check your panels if this continues.`,
  };
}

const noteBg: Record<Tone, string> = { warn: "bg-warn-subtle", ok: "bg-canvas", wait: "bg-canvas" };
const noteDot: Record<Tone, string> = { warn: "bg-solar", ok: "bg-good", wait: "bg-grey-500" };

export function SolarPerformance({ performance: P }: { performance: Insights["performance"] }) {
  const days = P?.days ?? [];
  const rated = days.filter((d): d is Rated => d.ratio != null);
  const { tone, note } = performanceNote(P, rated);
  return (
    <Card aria-labelledby="h-sp">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <TitleBlock
          id="h-sp"
          title="Solar performance"
          sub="Actual output compared with expected output for the weather, last 30 days"
        />
        <div className="flex flex-col items-end gap-0.5">
          <Eyebrow>30-day average</Eyebrow>
          <Figure small>
            {rated.length ? pct((rated.reduce((a, d) => a + d.ratio, 0) / rated.length) * 100) : DASH}
          </Figure>
        </div>
      </div>
      {rated.length > 0 && (
        <>
          <div className="relative flex h-40 items-end gap-1 max-sm:gap-0.5">
            <div className="pointer-events-none absolute inset-x-0 top-1/4 border-t border-dashed border-line-strong">
              <span className="absolute right-0 bottom-1 bg-surface pl-1.5 font-mono text-[10px] text-ink-faint">
                100% of expected
              </span>
            </div>
            {days.map((d) => (
              <DayBar key={d.date} day={d} />
            ))}
          </div>
          <div className="flex justify-between font-mono text-[11px] text-ink-faint">
            {[days[0], days[Math.floor(days.length / 2)], days[days.length - 1]].map((d, i) => (
              <span key={i}>{dayLabel(d)}</span>
            ))}
          </div>
        </>
      )}
      <div className={cn("flex items-start gap-3 rounded-xl px-4 py-3.5", noteBg[tone])}>
        <i className={cn("mt-[7px] size-2 flex-none rounded-full", noteDot[tone])} />
        <span className="text-sm leading-[22px] text-pretty">{note}</span>
      </div>
      {P && P.fitted_hours >= 24 && (
        <Footnote>
          {`Expected output is learned from ${P.fitted_hours.toLocaleString("en-AU")} daylight hours of your inverter's output against past weather from Open-Meteo, so 100% is how your system usually performs.`}
        </Footnote>
      )}
    </Card>
  );
}

function DayBar({ day: d }: { day: Day }) {
  const label = shortDay.format(parseYmd(d.date));
  const base = "min-w-0 flex-1 rounded-[4px_4px_2px_2px]";
  if (d.ratio == null) return <div className={base} style={{ height: 0 }} title={`${label}: not enough readings`} />;
  // 70% of expected sits at the floor and 110% at the top, so 100% lines up with the dashed reference.
  const h = Math.max(0.04, Math.min(1, (d.ratio - 0.7) / 0.4)) * 100;
  return (
    <div
      className={cn(base, isLow(d) ? "bg-solar" : "bg-bar-muted")}
      style={{ height: `${h.toFixed(1)}%` }}
      title={`${label}: ${pct(d.ratio * 100)} of expected (${kWh(d.actual_kwh)} of ${kWh(d.expected_kwh)})${d.clear ? "" : ", cloudy"}`}
    />
  );
}
