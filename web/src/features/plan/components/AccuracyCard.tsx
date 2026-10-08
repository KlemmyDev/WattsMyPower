import { useState, type CSSProperties, type ReactNode } from "react";
import type { ForecastAccuracy } from "~/features/common/weather/types";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Card, CardHeader, Eyebrow, Muted } from "~/features/common/ui/components/Card";
import { parseYmd, shortDay } from "~/features/common/formatting/utils/date";
import { kWh, plural } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { cn } from "~/features/common/ui/utils";

const SHOWN = 14; // days in the chart

type Day = ForecastAccuracy["days"][number];
type Range = NonNullable<ForecastAccuracy["range"]>;

/** A day's likely range: what the panels make on 8 in 10 days with that forecast. */
const likely = (d: Day, r: Range) => [d.forecast_kwh * r.low, d.forecast_kwh * r.high] as const;
const inside = (d: Day, r: Range) => {
  const [lo, hi] = likely(d, r);
  return d.actual_kwh >= lo - 0.05 && d.actual_kwh <= hi + 0.05;
};

/** Gridline values: about three, at a round step. */
function ticks(top: number): number[] {
  const step = [1, 2, 5, 10, 20, 50].find((s) => top / s <= 4) ?? 100;
  return Array.from({ length: Math.floor(top / step) }, (_, k) => (k + 1) * step);
}

/** How far a day's actual was from its forecast, in words: "12% under", "on the mark". */
function missWords(d: Day): string {
  if (d.forecast_kwh < 0.1) return "";
  const off = (d.actual_kwh - d.forecast_kwh) / d.forecast_kwh;
  if (Math.abs(off) < 0.03) return "on the mark";
  return `${Math.round(Math.abs(off) * 100)}% ${off > 0 ? "more" : "less"} than forecast`;
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub: ReactNode }) {
  return (
    // On a phone, a row: the label and its note on the left, the figure on the right.
    <div className="flex min-w-0 flex-col gap-1 rounded-2xl bg-surface-inset px-4 py-3.5 max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:items-center max-md:gap-x-4 max-md:gap-y-0.5 max-md:py-3">
      <Eyebrow className="max-md:col-start-1 max-md:row-start-1">{label}</Eyebrow>
      <span className="text-[26px] leading-8 font-light tracking-[-0.75px] whitespace-nowrap tabular-nums max-md:col-start-2 max-md:row-span-2 max-md:row-start-1 max-md:text-xl">
        {value}
      </span>
      <span className="text-xs text-pretty text-ink-muted tabular-nums max-md:col-start-1 max-md:row-start-2">
        {sub}
      </span>
    </div>
  );
}

/**
 * How close the day-ahead solar forecast has come lately. Three figures: how far out it usually is, which way it
 * leans, and how often days land in the likely range. Then each day: the forecast as a line, the likely range around
 * it shaded, and what the panels made as a dot, joined to the forecast so the miss is the length of the stem.
 */
export function AccuracyCard({ accuracy }: { accuracy: ForecastAccuracy | null | undefined }) {
  const [hover, setHover] = useState<string | null>(null);
  const days = accuracy?.days.slice(-SHOWN) ?? [];
  const r = accuracy?.range ?? null;
  const shown = days.find((d) => d.date === hover) ?? days[days.length - 1];
  return (
    <Card aria-labelledby="h-acc">
      <CardHeader
        title="How close the forecast has been"
        id="h-acc"
        action={
          <ButtonLink to="/integrations/weather" variant="link">
            Forecast settings
          </ButtonLink>
        }
      />
      {accuracy === undefined ? (
        <Muted>Loading</Muted>
      ) : accuracy === null ? (
        <Muted>Unavailable right now.</Muted>
      ) : !days.length || accuracy.mae_kwh == null ? (
        <Muted>
          Each day's solar forecast is kept as it stood the day before, to compare with what the panels made. The first
          comparison shows after a full day.
        </Muted>
      ) : (
        <>
          <Stats accuracy={accuracy} />
          <div className="flex flex-col gap-3">
            <Chart days={days} range={r} shown={shown} setHover={setHover} />
            <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1.5 text-xs text-ink-dim tabular-nums">
              <span className="flex flex-wrap gap-x-4 gap-y-1">
                <span className="flex items-center gap-1.5">
                  <i className="h-0.5 w-3 rounded-full bg-ink" />
                  Forecast the day before
                </span>
                <span className="flex items-center gap-1.5">
                  <i className="size-2.5 rounded-full" style={{ background: COLOR.solar }} />
                  Made
                </span>
                {r && (
                  <span className="flex items-center gap-1.5">
                    <i className="h-3 w-2.5 rounded-[3px]" style={{ background: alpha(COLOR.solar, 0.22) }} />
                    Likely range
                  </span>
                )}
              </span>
              {shown && (
                <span aria-live="polite" className="text-ink-muted">
                  <b className="font-semibold text-ink">{shortDay.format(parseYmd(shown.date))}</b>:{" "}
                  {kWh(shown.forecast_kwh)} forecast, {kWh(shown.actual_kwh)} made
                  {missWords(shown) && ` (${missWords(shown)})`}
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

/** The three figures over every day compared (up to 30), not just the ones charted. */
function Stats({ accuracy }: { accuracy: ForecastAccuracy }) {
  const all = accuracy.days;
  const mae = accuracy.mae_kwh ?? 0;
  const bias = accuracy.bias_kwh ?? 0;
  const mean = accuracy.actual_mean;
  const r = accuracy.range;
  const hits = r ? all.filter((d) => inside(d, r)).length : 0;
  const lean = Math.abs(bias) < 0.1 || (mean && Math.abs(bias) < mean * 0.03);
  return (
    <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1 max-md:gap-2">
      <Stat
        label="Usually out by"
        value={kWh(mae)}
        sub={
          mean
            ? `a day: ${Math.round((mae / mean) * 100)}% of an average ${kWh(mean)} day, over ${all.length} ${plural(all.length, "day")}`
            : `a day, over ${all.length} ${plural(all.length, "day")}`
        }
      />
      <Stat
        label="It tends to"
        value={lean ? "Be about right" : bias > 0 ? "Guess high" : "Guess low"}
        sub={
          lean
            ? "No lean either way: misses go both ways."
            : `By ${kWh(Math.abs(bias))} a day on average: the panels made ${bias > 0 ? "less" : "more"} than forecast.`
        }
      />
      {r ? (
        <Stat
          label="Inside the likely range"
          value={`${hits} of ${all.length}`}
          sub={`Days that made ${Math.round(r.low * 100)}–${Math.round(r.high * 100)}% of the forecast, the range each day's forecast gives.`}
        />
      ) : (
        <Stat
          label="Likely range"
          value="Soon"
          sub={`Shows once there's a week of days to compare (${all.length} so far).`}
        />
      )}
    </div>
  );
}

function Chart({
  days,
  range: r,
  shown,
  setHover,
}: {
  days: Day[];
  range: Range | null;
  shown: Day | undefined;
  setHover: (d: string | null) => void;
}) {
  const top =
    Math.max(1, ...days.flatMap((d) => [d.actual_kwh, d.forecast_kwh * (r ? Math.max(1, r.high) : 1)])) * 1.08;
  const y = (v: number) => `${(Math.max(0, v) / top) * 100}%`;
  return (
    <div className="flex gap-2">
      {/* The kWh scale, with gridlines across the plot. */}
      <div className="relative h-40 w-9 flex-none text-right text-[11px] text-ink-faint tabular-nums compact:h-28">
        {ticks(top).map((t) => (
          <span key={t} className="absolute right-0 translate-y-1/2" style={{ bottom: y(t) }}>
            {t}
          </span>
        ))}
        <span className="absolute right-0 bottom-0 translate-y-1/2">0</span>
        <span className="absolute -top-1 right-0 -translate-y-full">kWh</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div
          role="group"
          aria-label={`Forecast solar against what the panels made, the last ${days.length} days`}
          className="relative h-40 compact:h-28"
          onPointerLeave={() => setHover(null)}
        >
          {ticks(top).map((t) => (
            <div
              key={t}
              aria-hidden
              className="absolute inset-x-0 border-t border-line-subtle"
              style={{ bottom: y(t) }}
            />
          ))}
          <div aria-hidden className="absolute inset-x-0 bottom-0 border-t border-line" />
          <div className="absolute inset-0 flex">
            {days.map((d, k) => {
              const on = d.date === shown?.date;
              const [lo, hi] = r ? likely(d, r) : [0, 0];
              const miss = missWords(d);
              return (
                <div
                  key={d.date}
                  tabIndex={0}
                  role="img"
                  aria-label={
                    `${shortDay.format(parseYmd(d.date))}: forecast ${kWh(d.forecast_kwh)}, made ${kWh(d.actual_kwh)}` +
                    (miss ? `, ${miss}` : "") +
                    (r ? `, likely ${kWh(lo)} to ${kWh(hi)}` : "")
                  }
                  className={cn(
                    "relative h-full min-w-0 flex-1 cursor-default rounded-md outline-offset-[-2px]",
                    on && "bg-fg/5",
                  )}
                  onPointerEnter={() => setHover(d.date)}
                  onFocus={() => setHover(d.date)}
                >
                  {r && (
                    <span
                      aria-hidden
                      className="bar-grow absolute left-1/2 w-[56%] max-w-6 -translate-x-1/2 rounded-[4px]"
                      style={
                        {
                          bottom: y(lo),
                          height: `calc(${y(hi)} - ${y(lo)})`,
                          background: alpha(COLOR.solar, on ? 0.32 : 0.2),
                          "--i": k,
                        } as CSSProperties
                      }
                    />
                  )}
                  {/* The miss: a stem from the forecast to what was made. */}
                  <span
                    aria-hidden
                    className="absolute left-1/2 w-0.5 -translate-x-1/2 bg-fg/30"
                    style={{
                      bottom: y(Math.min(d.forecast_kwh, d.actual_kwh)),
                      height: `calc(${y(Math.max(d.forecast_kwh, d.actual_kwh))} - ${y(Math.min(d.forecast_kwh, d.actual_kwh))})`,
                    }}
                  />
                  <span
                    aria-hidden
                    className="absolute left-1/2 h-0.5 w-[72%] max-w-7 -translate-x-1/2 translate-y-1/2 rounded-full bg-ink"
                    style={{ bottom: y(d.forecast_kwh) }}
                  />
                  <span
                    aria-hidden
                    className="absolute left-1/2 size-2.5 -translate-x-1/2 translate-y-1/2 rounded-full shadow-[0_0_0_2px_var(--color-surface)] motion-safe:animate-[wmpFade_400ms_ease-out_both]"
                    style={{
                      bottom: y(d.actual_kwh),
                      background: COLOR.solar,
                      animationDelay: `${120 + Math.min(k, 24) * 18}ms`,
                      scale: on ? "1.3" : undefined,
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        {/* Day of the month under each day; the weekday is in the readout. */}
        <div aria-hidden className="flex text-[11px] text-ink-faint tabular-nums">
          {days.map((d) => (
            <span
              key={d.date}
              className={cn("min-w-0 flex-1 text-center", d.date === shown?.date && "font-semibold text-ink")}
            >
              {parseYmd(d.date).getDate()}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
