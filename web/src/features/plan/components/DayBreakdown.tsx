import type { ReactNode } from "react";
import type { SystemInfo } from "~/features/common/live/types";
import type { Forecast } from "~/features/common/weather/types";
import { weekdayLong } from "~/features/common/formatting/utils/date";
import { kWh, kWhInt } from "~/features/common/formatting/utils/number";
import { COLOR } from "~/features/common/theme/utils/colors";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Eyebrow } from "~/features/common/ui/components/Card";
import { cn } from "~/features/common/ui/utils";
import type { PlanDay } from "~/features/plan/utils";

/** A date key's local weekday (0 Sunday), read as a date rather than a UTC midnight. */
const weekdayOf = (date: string) => new Date(`${date}T12:00:00`).getDay();
const plural = (n: number) => `${weekdayLong.format(new Date(2026, 0, 4 + n))}s`; // 4 Jan 2026 was a Sunday

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
    <div className="flex flex-col gap-3">
      <Eyebrow>{label}</Eyebrow>
      <span className="text-[34px] leading-10 font-light tracking-[-1px] tabular-nums" style={{ color }}>
        {kWh(total)}
      </span>
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
 * The chosen day's home use and solar, and how each was worked out: home use from the house's typical day (with
 * the last two weeks drawn, the chosen day's weekday picked out), solar from the forecast sunlight and how the
 * model turns it into energy.
 */
export function DayBreakdown({
  day,
  forecast,
  system,
}: {
  day: PlanDay;
  forecast: Forecast;
  system: SystemInfo | undefined;
}) {
  return (
    <div className="grid grid-cols-2 gap-10 max-lg:grid-cols-1 max-lg:gap-8">
      <HomeUse day={day} forecast={forecast} />
      <Solar day={day} forecast={forecast} system={system} />
    </div>
  );
}

function HomeUse({ day, forecast }: { day: PlanDay; forecast: Forecast }) {
  const basis = forecast.load_basis;
  const typical = basis?.typical_kwh ?? day.day.load_kwh;
  const rest = day.day.load_kwh;
  const parts: [string, number][] = day.soFar
    ? [
        ["Used so far", day.soFar.load],
        ["Expected for the rest of the day", rest],
      ]
    : [["Your typical day", rest]];
  const missing = basis ? 24 - basis.hours_known : 0;
  const wd = weekdayOf(day.key);
  const same = basis?.days.filter((d) => weekdayOf(d.date) === wd) ?? [];
  return (
    <div className="flex flex-col gap-4">
      <Total label="Home use" total={day.load} color={COLOR.ink} parts={parts} />
      <About>
        Your typical day is <b className="font-medium text-ink">{kWh(typical)}</b>. For each hour of the day it takes
        what your home used in that hour over the last {basis?.window_days ?? 14} days, leaving out the highest and
        lowest fifth of days, so a one-off like guests or a long car charge doesn't move it.
        {day.soFar ? " The rest of today is the typical day's remaining hours." : ""} It's the same whichever day of the
        week it is, and doesn't change with the weather.
        {missing > 0 &&
          ` ${missing} ${missing === 1 ? "hour" : "hours"} of the day ${missing === 1 ? "has" : "have"} no readings yet, so ${missing === 1 ? "it uses" : "they use"} a typical household's use.`}
      </About>
      {basis && basis.days.length > 0 && <RecentDays basis={basis} weekday={wd} same={same} />}
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
              title={`${weekdayLong.format(new Date(`${d.date}T12:00:00`))} ${d.date.slice(8)}: ${kWh(d.kwh)}`}
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
            {weekdayLong.format(new Date(`${d.date}T12:00:00`)).slice(0, 1)}
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

function Solar({ day, forecast, system }: { day: PlanDay; forecast: Forecast; system: SystemInfo | undefined }) {
  const rest = day.day.pv_kwh;
  const parts: [string, number][] = day.soFar
    ? [
        ["Made so far", day.soFar.pv],
        ["Expected for the rest of the day", rest],
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
          Likely {Math.round(day.pvRange[0])} to {kWhInt(day.pvRange[1])}: where 8 in 10 days like it have landed, from
          how the forecast has done lately.
        </span>
      )}
      <About>
        {model?.kind === "learned" ? (
          <>
            From the forecast weather for {what}, through a model learned from {model.days} days of your weather history
            and what your panels made. It's used because it has come closer than the simple model
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
                , <b className="font-medium text-ink">{sun.toFixed(1)} kWh/m²</b>,
              </>
            ) : (
              ""
            )}{" "}
            times <b className="font-medium text-ink">{cal.kwh_per_kwh_m2.toFixed(2)} kWh</b> for each kWh/m², which is
            what your panels have made from the sunlight over the last week ({cal.fitted_hours} hours of readings). That
            takes in which way they face, shade and the inverter's limit without them being set.
          </>
        ) : (
          <>
            The forecast sunlight for {what}
            {sun != null ? ` (${sun.toFixed(1)} kWh/m²)` : ""} times 80% of your array's size
            {system?.pv_kw ? ` (${system.pv_kw} kW)` : ""}. Once it has a few daylight hours of your inverter's output,
            it calibrates to what your panels actually make.
          </>
        )}
      </About>
      <div className="flex flex-wrap items-center gap-x-2 text-[13px] text-ink-muted">
        <span>Solar array: {system?.pv_kw ? `${system.pv_kw} kW` : "not set"}</span>
        <ButtonLink to="/system/solar-battery" variant="link" size="sm">
          Change
        </ButtonLink>
      </div>
    </div>
  );
}
