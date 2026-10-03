import { useState, type CSSProperties } from "react";
import type { ForecastAccuracy } from "~/features/common/weather/types";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Card, CardHeader, Muted } from "~/features/common/ui/components/Card";
import { parseYmd, shortDay } from "~/features/common/formatting/utils/date";
import { kWh, plural } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";

const SHOWN = 14; // days in the chart

/** How close the day-ahead solar forecast has come lately, and what that means for the days ahead. */
export function AccuracyCard({ accuracy }: { accuracy: ForecastAccuracy | null | undefined }) {
  const [hover, setHover] = useState<string | null>(null);
  const days = accuracy?.days.slice(-SHOWN) ?? [];
  const top = Math.max(1, ...days.flatMap((d) => [d.forecast_kwh, d.actual_kwh]));
  const r = accuracy?.range;
  const shown = days.find((d) => d.date === hover) ?? days[days.length - 1];
  return (
    <Card aria-labelledby="h-acc">
      <CardHeader
        title="How close the forecast has been"
        id="h-acc"
        action={
          <ButtonLink to="/settings/integrations/weather" variant="link">
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
          <div className="flex flex-col gap-1.5 text-sm text-pretty text-ink-body">
            <span>
              Over the last {accuracy.days.length} {plural(accuracy.days.length, "day")}, the day-ahead forecast was out
              by {kWh(accuracy.mae_kwh)} a day on average
              {accuracy.actual_mean ? `, on days averaging ${kWh(accuracy.actual_mean)}` : ""}
              {accuracy.bias_kwh != null && Math.abs(accuracy.bias_kwh) >= 0.1
                ? `. It's tended to ${accuracy.bias_kwh > 0 ? "over" : "under"}-forecast, by ${kWh(Math.abs(accuracy.bias_kwh))} a day`
                : ""}
              .
            </span>
            <span className="text-ink-muted">
              {r
                ? `On 8 in 10 days, the panels made between ${Math.round(r.low * 100)}% and ${Math.round(r.high * 100)}% of the forecast. That's the likely range shaded on the chart and given for each day.`
                : `A likely range for each day shows once there's a week of days to compare (${accuracy.days.length} so far).`}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex h-28 items-end gap-1.5" onPointerLeave={() => setHover(null)}>
              {days.map((d, k) => (
                <div
                  key={d.date}
                  className="flex h-full min-w-0 flex-1 cursor-default items-end justify-center gap-0.5 rounded-md"
                  style={{ background: d.date === shown?.date ? alpha(COLOR.fg, 0.05) : undefined }}
                  onPointerEnter={() => setHover(d.date)}
                  aria-label={`${shortDay.format(parseYmd(d.date))}: forecast ${kWh(d.forecast_kwh)}, made ${kWh(d.actual_kwh)}`}
                >
                  <span
                    className="bar-grow w-full max-w-2.5 rounded-t-[3px] border border-b-0"
                    style={
                      {
                        height: `${(d.forecast_kwh / top) * 100}%`,
                        borderColor: COLOR.solar,
                        "--i": k,
                      } as CSSProperties
                    }
                  />
                  <span
                    className="bar-grow w-full max-w-2.5 rounded-t-[3px]"
                    style={
                      { height: `${(d.actual_kwh / top) * 100}%`, background: COLOR.solar, "--i": k } as CSSProperties
                    }
                  />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1 text-xs text-ink-dim tabular-nums">
              <span className="flex gap-4">
                <span className="flex items-center gap-1.5">
                  <i className="size-2.5 rounded-[2px] border" style={{ borderColor: COLOR.solar }} />
                  Forecast the day before
                </span>
                <span className="flex items-center gap-1.5">
                  <i className="size-2.5 rounded-[2px]" style={{ background: COLOR.solar }} />
                  Made
                </span>
              </span>
              {shown && (
                <span>
                  {shortDay.format(parseYmd(shown.date))}: {kWh(shown.forecast_kwh)} forecast, {kWh(shown.actual_kwh)}{" "}
                  made
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
