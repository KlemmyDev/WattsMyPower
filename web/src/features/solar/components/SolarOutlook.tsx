import { parseYmd, shortDay } from "~/features/common/formatting/utils/date";
import { kWh, pct } from "~/features/common/formatting/utils/number";
import { LocationPrompt } from "~/features/common/settings/components/LocationPrompt";
import { useLocationSet } from "~/features/common/settings/hooks";
import { dateKey } from "~/features/common/time/utils";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Card, Footnote, Muted, TitleBlock } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { dim, usePick } from "~/features/common/ui/components/Pick";
import { cn } from "~/features/common/ui/utils";
import { useFahrenheit } from "~/features/common/weather/hooks";
import type { Forecast, ForecastAccuracy, ForecastDay } from "~/features/common/weather/types";
import { codeIcon, codeName, degrees, hourIconColor } from "~/features/common/weather/utils";

/**
 * The rest of today and the next two days, a card each: the day, the sky and temperatures, the solar the forecast
 * expects and the range it usually lands in. Pointing at or choosing a day lights it and reads its detail out under
 * the heading. The link in the corner opens that day on the Plan page, where the battery and the grid are.
 */
export function SolarOutlook({
  f,
  acc,
  now,
}: {
  f: Forecast | null | undefined;
  acc: ForecastAccuracy | null | undefined;
  now: number;
}) {
  const fahrenheit = useFahrenheit();
  const located = useLocationSet();
  const { picked, plot, item } = usePick<number>();
  if (located === false)
    return (
      <Card className="h-full">
        <TitleBlock title="Days ahead" sub="Solar the forecast expects, today and the next two days" />
        <LocationPrompt>The forecast needs to know where your panels are.</LocationPrompt>
      </Card>
    );
  if (!f) return null;
  const days = f.days;
  const range = acc?.range ?? null;
  const top = Math.max(0.1, ...days.map((d) => d.pv_kwh * (range?.high ?? 1)));
  const name = (d: ForecastDay) => (d.date === dateKey(now) ? "Today" : shortDay.format(parseYmd(d.date)));
  const likely = (d: ForecastDay) =>
    range ? `Likely ${(d.pv_kwh * range.low).toFixed(1)} to ${kWh(d.pv_kwh * range.high)}` : "Range builds up in time";
  const temps = (d: ForecastDay) =>
    d.temp_min != null && d.temp_max != null
      ? `${degrees(d.temp_min, fahrenheit)} to ${degrees(d.temp_max, fahrenheit)}`
      : null;
  const detail = (d: ForecastDay) =>
    [
      d.code != null ? codeName(d.code) : null,
      temps(d),
      d.sun_kwh_m2 != null ? `${d.sun_kwh_m2.toFixed(1)} kWh/m² of sun` : null,
      d.precip >= 40 ? `${d.precip}% chance of rain` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  const sub = "Solar the forecast expects, today and the next two days";
  const close =
    acc?.mae_kwh != null ? `The forecast is usually within ${kWh(acc.mae_kwh)} a day of what your panels make.` : null;
  const open = picked != null ? days[picked] : null;

  return (
    <Card aria-labelledby="h-outlook" className="gap-5">
      <div className="flex items-start justify-between gap-4">
        <TitleBlock
          id="h-outlook"
          title="Days ahead"
          className="min-w-0 flex-1"
          sub={
            <span aria-live="polite" className="block min-h-10">
              {open ? `${name(open)}, ${shortDay.format(parseYmd(open.date))}: ${detail(open) || "forecast"}` : sub}
            </span>
          }
        />
        <ButtonLink to="/plan" search={{ day: picked ?? undefined }} variant="link" size="sm" className="flex-none">
          See the full plan
        </ButtonLink>
      </div>
      <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-1" {...plot}>
        {days.map((d, i) => {
          const sky = d.code != null ? codeIcon(d.code, true) : null;
          return (
            <button
              key={d.date}
              type="button"
              {...item(i)}
              aria-pressed={picked === i}
              className={cn(
                "flex cursor-pointer flex-col gap-3 rounded-2xl border-0 bg-fg/5 p-4 text-left transition-colors duration-200 hover:bg-fg/8",
                picked === i && "ring-1 ring-ink-soft",
                dim(picked, i),
              )}
            >
              <span className="flex items-center justify-between gap-2 text-[13px] text-ink-muted">
                <span className="truncate">{name(d)}</span>
                {sky && (
                  <span className="flex flex-none items-center gap-1.5" style={{ color: hourIconColor(sky) }}>
                    <Icon name={sky} size={16} />
                  </span>
                )}
              </span>
              <span className="text-[28px] leading-8 font-light tracking-[-1px] tabular-nums">{kWh(d.pv_kwh)}</span>
              <span className="relative block h-1.5 rounded-full bg-track">
                {range && (
                  <span
                    className="absolute inset-y-0 rounded-full"
                    style={{
                      left: `${((d.pv_kwh * range.low) / top) * 100}%`,
                      width: `${((d.pv_kwh * (range.high - range.low)) / top) * 100}%`,
                      background: alpha(COLOR.solar, 0.3),
                    }}
                  />
                )}
                <span
                  className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{ left: `${(d.pv_kwh / top) * 100}%`, background: COLOR.solar }}
                />
              </span>
              <span className="flex flex-col gap-0.5 text-xs text-ink-faint tabular-nums">
                <span>{likely(d)}</span>
                <span className="text-ink-muted">
                  {[temps(d), d.precip >= 40 ? `${d.precip}% rain` : null].filter(Boolean).join(" · ") || "—"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {close && <Muted>{close}</Muted>}
      {range && (
        <Footnote>
          {`The likely range is where 8 in 10 of the last ${range.days} days landed against their forecast, ${pct(range.low * 100)} to ${pct(range.high * 100)} of it.`}
        </Footnote>
      )}
    </Card>
  );
}
