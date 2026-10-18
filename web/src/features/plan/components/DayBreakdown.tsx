import { useId, useState, type ReactNode } from "react";
import type { SystemInfo } from "~/features/common/live/types";
import type { Forecast } from "~/features/common/weather/types";
import { parseYmd, weekdayLong } from "~/features/common/formatting/utils/date";
import { partsOf, siteTime } from "~/features/common/time/utils";
import { kWh, kWhInt } from "~/features/common/formatting/utils/number";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Button, ButtonLink } from "~/features/common/ui/components/Button";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Collapse } from "~/features/common/ui/components/Collapse";
import { cn } from "~/features/common/ui/utils";
import type { PlanDay } from "~/features/plan/utils";

/** A date key's weekday (0 Sunday). */
const weekdayOf = (date: string) => partsOf(parseYmd(date)).weekday;
const plural = (n: number) => `${weekdayLong.format(siteTime(2026, 1, 4 + n, 12) * 1000)}s`; // 4 Jan 2026 was a Sunday

/** A figure and what makes it up: the total, then a line per part. */
function Total({
  label,
  total,
  color,
  parts,
}: {
  label: string;
  total: number;
  color: string;
  parts: [string, number][];
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-1.5 text-[13px] text-ink-muted">
        <i className="size-2 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className="text-[28px] leading-8 font-light tracking-[-0.8px] tabular-nums">{kWh(total)}</span>
      {parts.length > 0 && (
        <dl className="m-0 flex flex-col gap-1.5 text-[13px] tabular-nums">
          {parts.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt className="text-ink-muted">{k}</dt>
              <dd className="m-0 font-medium text-ink">{kWh(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

const About = ({ children }: { children: ReactNode }) => (
  <p className="m-0 text-[13px] leading-5 text-pretty text-ink-muted">{children}</p>
);

/**
 * The chosen day's home use and solar, as a card: each total and what makes it up, the last two weeks of home use
 * (the chosen day's weekday picked out), and, a tap away, how each was worked out: home use from the house's typical
 * day, solar from the forecast sunlight and how the model turns it into energy.
 */
export function DayBreakdown({
  day,
  forecast,
  system,
  className,
}: {
  day: PlanDay;
  forecast: Forecast;
  system: SystemInfo | undefined;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <Card aria-labelledby={`${id}-h`} className={className}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <TitleBlock id={`${id}-h`} title="Home use and solar" sub={`${day.label}'s totals, and what makes them up`} />
        <Button
          variant="link"
          size="sm"
          aria-expanded={open}
          aria-controls={`${id}-how`}
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide how it's worked out" : "How it's worked out"}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-10 max-lg:grid-cols-1 max-lg:gap-8">
        <HomeUse day={day} forecast={forecast} open={open} id={`${id}-how`} />
        <Solar day={day} forecast={forecast} system={system} open={open} />
      </div>
    </Card>
  );
}

function HomeUse({ day, forecast, open, id }: { day: PlanDay; forecast: Forecast; open: boolean; id: string }) {
  const basis = forecast.load_basis;
  const typical = basis?.typical_kwh ?? day.day.load_kwh;
  const rest = day.day.load_kwh;
  const parts: [string, number][] = day.soFar
    ? [
        ["Used so far", day.soFar.load],
        ["Expected for the rest of the day", rest],
      ]
    : [];
  const missing = basis ? 24 - basis.hours_known : 0;
  const wd = weekdayOf(day.key);
  const same = basis?.days.filter((d) => weekdayOf(d.date) === wd) ?? [];
  return (
    <div className="flex flex-col gap-4">
      <Total label="Home use" total={day.load} color={COLOR.teal} parts={parts} />
      {basis && basis.days.length > 0 && <RecentDays basis={basis} weekday={wd} same={same} />}
      <Collapse open={open} id={id}>
        <About>
          Your typical day is <b className="font-medium text-ink">{kWh(typical)}</b>. Each hour is what your home used
          in that hour over the last {basis?.window_days ?? 14} days. The highest and lowest fifth of days are left out,
          so a one-off like guests or a long car charge doesn't skew it.
          {day.soFar ? " The rest of today is the typical day's remaining hours." : ""} It's the same every day of the
          week and doesn't change with the weather.
          {missing > 0 &&
            ` ${missing} ${missing === 1 ? "hour" : "hours"} of the day ${missing === 1 ? "has" : "have"} no readings yet, so a typical household's use fills ${missing === 1 ? "it" : "them"} in.`}
        </About>
      </Collapse>
    </div>
  );
}

/** The last two weeks' home use as bars, the chosen weekday's darker, with the typical day as a dashed line. */
function RecentDays({
  basis,
  weekday,
  same,
}: {
  basis: NonNullable<Forecast["load_basis"]>;
  weekday: number;
  same: { date: string; kwh: number }[];
}) {
  const top = Math.max(basis.typical_kwh, ...basis.days.map((d) => d.kwh)) * 1.1 || 1;
  const kwhs = basis.days.map((d) => d.kwh);
  const mean = kwhs.reduce((a, b) => a + b, 0) / kwhs.length;
  return (
    <figure className="m-0 flex flex-col gap-2">
      <div
        role="img"
        aria-label={`Home use over the last ${basis.days.length} days, from ${kWhInt(Math.min(...kwhs))} to ${kWhInt(Math.max(...kwhs))}`}
        className="relative flex h-24 items-end gap-1 border-b border-line"
      >
        {basis.days.map((d) => {
          const on = weekdayOf(d.date) === weekday;
          return (
            <span
              key={d.date}
              title={`${weekdayLong.format(parseYmd(d.date))} ${d.date.slice(8)}: ${kWh(d.kwh)}`}
              className={cn("flex-1 rounded-t-[3px]", on ? "bg-ink" : "bg-ink/20")}
              style={{ height: `${(d.kwh / top) * 100}%` }}
            />
          );
        })}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-ink-muted"
          style={{ bottom: `${(basis.typical_kwh / top) * 100}%` }}
        />
      </div>
      <div className="flex gap-1 font-mono text-[10px] text-ink-faint">
        {basis.days.map((d) => (
          <span key={d.date} className="flex-1 text-center">
            {weekdayLong.format(parseYmd(d.date)).slice(0, 1)}
          </span>
        ))}
      </div>
      <figcaption className="text-xs leading-[18px] text-ink-dim tabular-nums">
        Your last {basis.days.length} days: {kWhInt(Math.min(...kwhs))} to {kWhInt(Math.max(...kwhs))}, {kWhInt(mean)}{" "}
        on average. The dashed line is the typical day.
        {same.length > 0 && ` ${plural(weekday)}: ${same.map((d) => kWhInt(d.kwh)).join(" and ")}.`}
      </figcaption>
    </figure>
  );
}

function Solar({
  day,
  forecast,
  system,
  open,
}: {
  day: PlanDay;
  forecast: Forecast;
  system: SystemInfo | undefined;
  open: boolean;
}) {
  const rest = day.day.pv_kwh;
  const parts: [string, number][] = day.soFar
    ? [
        ["Made so far", day.soFar.pv],
        ...(rest >= 0.05 ? [["Expected for the rest of the day", rest] as [string, number]] : []),
      ]
    : [];
  const model = forecast.model;
  const cal = forecast.calibration;
  const sun = day.day.sun_kwh_m2;
  const bt = model?.backtest;
  const what = day.soFar ? "the rest of today" : "the day";
  return (
    <div className="flex flex-col gap-4">
      <Total label="Solar" total={day.pv} color={COLOR.solar} parts={parts} />
      {day.pvRange && (
        <span className="text-[13px] text-ink-muted tabular-nums">
          Likely {Math.round(day.pvRange[0])} to {kWhInt(day.pvRange[1])}, where 8 in 10 days like this have landed
          lately.
        </span>
      )}
      <Collapse open={open}>
        <About>
          {model?.kind === "learned" ? (
            <>
              Based on the forecast weather for {what} and a model learned from {model.days} days of your weather and
              what your panels made. It's in use because it has come closer than the simple model
              {bt?.learned_mae != null && bt.simple_mae != null
                ? ` (off by about ${kWh(bt.learned_mae)} a day, against ${kWh(bt.simple_mae)})`
                : ""}
              .
            </>
          ) : cal.fitted_hours >= 0.5 ? (
            <>
              The forecast sunlight for {what}
              {sun != null ? (
                <>
                  , <b className="font-medium text-ink">{sun.toFixed(1)} kWh of sunlight per m²</b>,
                </>
              ) : (
                ""
              )}{" "}
              times <b className="font-medium text-ink">{cal.kwh_per_kwh_m2.toFixed(2)} kWh</b> for each kWh of sunlight
              per m². That's what your panels have made from the sunlight over the last week ({cal.fitted_hours} hours
              of readings), so it already allows for which way they face, shade and the inverter's limit. You don't need
              to set those.
            </>
          ) : (
            <>
              The forecast sunlight for {what}
              {sun != null ? ` (${sun.toFixed(1)} kWh of sunlight per m²)` : ""} times 80% of your array's size
              {system?.pv_kw ? ` (${system.pv_kw} kW)` : ""}. Once it has a few daylight hours of your inverter's
              output, it calibrates to what your panels actually make.
            </>
          )}
        </About>
      </Collapse>
      <div className="flex flex-wrap items-center gap-x-2 text-[13px] text-ink-muted">
        <span>Solar array: {system?.pv_kw ? `${system.pv_kw} kW` : "not set"}</span>
        <ButtonLink to="/settings/solar-battery" variant="link" size="sm">
          Change
        </ButtonLink>
      </div>
    </div>
  );
}
