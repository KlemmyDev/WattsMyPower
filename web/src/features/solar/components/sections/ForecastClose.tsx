import { dayMonth } from "~/features/common/formatting/utils/date";
import { kWh, plural } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { fromDateKey } from "~/features/common/time/utils";
import { Card, Footnote, Muted } from "~/features/common/ui/components/Card";
import { Delta } from "~/features/common/ui/components/Live";
import type { ForecastAccuracy } from "~/features/common/weather/types";
import { PickHead, usePick } from "~/features/solar/components/sections/PerformanceParts";
import { rollingMiss } from "~/features/solar/utils/forecastSections";
import type { WeatherStatus } from "~/features/weather/types";

const W = 300;
const H = 80;

/**
 * The typical miss over each week of the last month, as a line: falling means the forecast is getting closer. Each
 * week's end is a column to point at, which reads that week out in the card's header.
 */
function MissLine({ runs, pick }: { runs: { date: string; kwh: number }[]; pick: ReturnType<typeof usePick<number>> }) {
  const top = Math.max(0.1, ...runs.map((r) => r.kwh)) * 1.15;
  const x = (i: number) => (runs.length > 1 ? (i / (runs.length - 1)) * W : W / 2);
  const y = (v: number) => H - (v / top) * H;
  const line = runs.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r.kwh).toFixed(1)}`).join(" ");
  const at = pick.picked;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-20">
        <svg
          aria-hidden
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
        >
          <path d={`${line} L${W},${H} L0,${H} Z`} style={{ fill: alpha(COLOR.good, 0.12) }} />
          <path
            d={line}
            fill="none"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            style={{ stroke: COLOR.good }}
          />
        </svg>
        {at != null && (
          <span
            aria-hidden
            className="pointer-events-none absolute size-2.5 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-surface"
            style={{
              left: `${(x(at) / W) * 100}%`,
              bottom: `${(runs[at].kwh / top) * 100}%`,
              background: COLOR.good,
            }}
          />
        )}
        <div className="absolute inset-0 flex" {...pick.plot}>
          {runs.map((r, i) => (
            <button
              key={r.date}
              type="button"
              {...pick.item(i)}
              aria-label={`Week to ${dayMonth(fromDateKey(r.date))}: typically ${kWh(r.kwh)} off`}
              className="h-full min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0"
            />
          ))}
        </div>
      </div>
      <div className="flex justify-between text-[11px] text-ink-faint">
        <span>{`Week to ${dayMonth(fromDateKey(runs[0].date))}`}</span>
        <span>This week</span>
      </div>
    </div>
  );
}

/**
 * How much learning from your roof helps: the back-test of the learned forecast against the plain one over the same
 * days, as two bars of their typical miss.
 */
function Learning({ learning: L }: { learning: WeatherStatus["learning"] }) {
  const b = L.backtest;
  if (!L.on) return null;
  if (!b || b.learned_mae == null || b.simple_mae == null)
    return (
      <Muted>
        {`The forecast starts learning your roof once it has ${L.min_days} days of weather and readings to learn from (${L.days} so far).`}
      </Muted>
    );
  const top = Math.max(b.learned_mae, b.simple_mae, 0.1);
  const gain = b.simple_mae - b.learned_mae;
  const bars: [string, number, string][] = [
    ["Learned from your roof", b.learned_mae, COLOR.good],
    ["A plain forecast", b.simple_mae, alpha(COLOR.fg, 0.3)],
  ];
  return (
    <div className="flex flex-col gap-3 border-t border-line-subtle pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">What learning adds</span>
        {gain > 0.05 && <Delta value={gain}>{kWh(gain)} closer a day</Delta>}
      </div>
      <div className="flex flex-col gap-2">
        {bars.map(([label, v, color]) => (
          <div key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-3">
            <span className="text-[13px] text-ink-muted">{label}</span>
            <span className="relative h-2.5 rounded-full bg-fg/4">
              <span
                className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out-soft"
                style={{ width: `${(v / top) * 100}%`, background: color }}
              />
            </span>
            <span className="text-right text-[13px] whitespace-nowrap tabular-nums">{kWh(v)} off</span>
          </div>
        ))}
      </div>
      <Muted>
        {gain > 0.05
          ? `Tested on ${b.days} past ${plural(b.days, "day")} it hadn't seen.${L.in_use ? " It's the one in use." : ""}`
          : `Tested on ${b.days} past ${plural(b.days, "day")}, learning isn't closer yet, so the plain forecast is in use.`}
      </Muted>
    </div>
  );
}

/**
 * How close the forecast gets: its typical miss over the last 30 days, the miss week by week (falling as it learns),
 * and how much learning from your roof helps against a plain forecast.
 */
export function ForecastClose({
  acc,
  learning,
}: {
  acc: ForecastAccuracy;
  learning: WeatherStatus["learning"] | undefined;
}) {
  const pick = usePick();
  const runs = rollingMiss(acc);
  const r = pick.picked != null ? runs[pick.picked] : null;
  const bias = acc.bias_kwh;
  return (
    <Card aria-labelledby="h-fc">
      <PickHead
        id="h-fc"
        title="How close it gets"
        sub={
          r
            ? `Week to ${dayMonth(fromDateKey(r.date))}`
            : runs.length > 1
              ? `Week by week over the last ${acc.days.length} days. Falling means it's learning.`
              : "The forecast's typical miss, either way, over the last days"
        }
        label={r ? "Typical miss that week" : "Typical miss"}
        value={kWh(r ? r.kwh : acc.mae_kwh)}
      />
      {runs.length > 1 && <MissLine runs={runs} pick={pick} />}
      {learning && <Learning learning={learning} />}
      {bias != null && Math.abs(bias) >= 0.1 && (
        <Footnote>{`On average it runs ${kWh(Math.abs(bias))} ${bias > 0 ? "high" : "low"} a day.`}</Footnote>
      )}
    </Card>
  );
}
