import type { Ref } from "react";
import { priceLabel } from "~/features/amber/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { DASH, kWh, money, pct, signedPct } from "~/features/common/formatting/utils/number";
import { COLOR } from "~/features/common/theme/utils/colors";
import { addDays } from "~/features/common/time/utils";
import {
  HeroBar,
  HeroCard,
  HeroFigures,
  HeroFill,
  HeroKey,
  HeroLead,
  HeroLive,
  HeroStat,
  HeroStats,
  HeroTick,
  HeroTop,
} from "~/features/common/ui/components/Hero";
import { Icon } from "~/features/common/ui/components/Icon";
import { Delta } from "~/features/common/ui/components/Live";
import { useFahrenheit } from "~/features/common/weather/hooks";
import { codeIcon, codeName, degrees, hourIconColor } from "~/features/common/weather/utils";
import { PlanChart } from "~/features/plan/components/PlanChart";
import { useDayPlan, type Plan } from "~/features/plan/hooks";
import { hourEnd, type bestTimes, type PlanDay, type Window } from "~/features/plan/utils";
import type { Moment } from "~/features/plan/utils/moments";

/** "Solar today", "Solar tomorrow", "Solar on Wednesday". */
export const solarLabel = (d: PlanDay) =>
  d.today ? "Solar today" : d.label === "Tomorrow" ? "Solar tomorrow" : `Solar on ${d.label}`;

const WINDOW: Record<Window["kind"], { label: string; color: string }> = {
  spare: { label: "Best for big loads", color: COLOR.export },
  paid: { label: "Paid to use power", color: COLOR.good },
  avoid: { label: "Go easy on the grid", color: COLOR.bad },
};

type Next = { label: string; value: string; unit?: string; sub: string; color: string; on: boolean };

/**
 * The next thing on the day worth acting on: the first of its best times still to come (spare solar, prices below
 * zero, the grid hours to go easy on), else its next key moment (the battery filling, rain coming).
 */
function nextUp(times: ReturnType<typeof bestTimes>, events: Moment[], now: number): Next | null {
  const w = [...times.spare, ...times.paid, ...times.avoid]
    .filter((x) => x.end > now)
    .sort((a, b) => a.start - b.start)[0];
  if (w) {
    const price =
      w.rate == null ? "" : ` · ${w.band && w.kind === "avoid" ? `${w.band} ` : ""}${priceLabel(w.rate)}/kWh`;
    return {
      ...WINDOW[w.kind],
      value: hhmm(w.start),
      unit: `to ${hhmm(w.end)}`,
      sub:
        w.kind === "spare"
          ? `${kWh(w.kwh)} of spare solar${price}`
          : w.kind === "paid"
            ? `Amber below zero${price}`
            : `${kWh(w.kwh)} from the grid${price}`,
      on: w.start <= now && now < w.end,
    };
  }
  const m = events.find((e) => e.t > now);
  return m ? { label: m.title, value: hhmm(m.t), sub: m.sub, color: m.color, on: false } : null;
}

/** The battery over the day as one stat: when it fills (or filled), or the highest it gets; the lowest under it. */
function batteryStat(d: PlanDay, now: number) {
  const low = d.hours.reduce<{ soc: number; t: number } | null>(
    (a, h) => (a == null || h.soc < a.soc ? { soc: h.soc, t: hourEnd(h) } : a),
    null,
  );
  const end = addDays(d.start, 1);
  const sub = low ? `Lowest ${pct(low.soc)} ${low.t >= end ? "by midnight" : `at ${hhmm(low.t)}`}` : undefined;
  const b = d.battery;
  if (b.now) return { label: "Battery", value: "Full now", sub };
  if (b.fullAt) return { label: b.fullAt <= now ? "Battery filled" : "Battery full by", value: hhmm(b.fullAt), sub };
  return { label: "Battery tops out", value: pct(b.max), sub };
}

/**
 * The look-ahead in one card, as Solar's, Home's and Battery's lead with today: the solar a day should bring (against
 * a usual day lately) and its weather, the next thing worth acting on, home use, the battery, the grid and the
 * expected cost; solar against home use along a bar, with its likely range; and, unless `chart` is off, the day hour
 * by hour (recorded so far today, then the forecast) with its best times and key moments marked.
 */
export function PlanHero({
  plan,
  day: d,
  now,
  chart = true,
  ref,
}: {
  plan: Plan;
  day: PlanDay;
  now: number;
  chart?: boolean;
  ref?: Ref<HTMLElement>;
}) {
  const { times, events } = useDayPlan(plan, d, now);
  const fahrenheit = useFahrenheit();
  const usual = plan.accuracy?.actual_mean;
  const vsUsual = usual && usual >= 1 ? (d.pv - usual) / usual : null;
  const [value, unit] = kWh(d.pv).split(" ");
  const next = times ? nextUp(times, events, now) : null;
  const bat = batteryStat(d, now);
  const icon = d.day.code != null ? codeIcon(d.day.code, true) : null;
  const done = d.today && d.day.pv_kwh < 0.05;
  return (
    <HeroCard ref={ref} label={`${d.label}'s plan`} tint={COLOR.export} className="scroll-mt-6">
      <HeroTop>
        <HeroFigures>
          <HeroLead
            label={solarLabel(d)}
            value={value}
            unit={unit}
            sub={
              <>
                {d.day.code != null && (
                  <span className="flex items-center gap-1.5">
                    {icon && (
                      <span style={{ color: hourIconColor(icon) }} className="flex">
                        <Icon name={icon} size={16} />
                      </span>
                    )}
                    {codeName(d.day.code)}
                    {d.day.temp_max != null && (
                      <span className="text-ink-faint">
                        {degrees(d.day.temp_max, fahrenheit)}
                        {d.day.temp_min != null && ` / ${degrees(d.day.temp_min, fahrenheit)}`}
                      </span>
                    )}
                  </span>
                )}
                {vsUsual != null && <Delta value={vsUsual}>{signedPct(vsUsual)} on a usual day</Delta>}
              </>
            }
          />
          {next && (
            <HeroLive
              label={next.label}
              on={next.on}
              color={next.color}
              value={next.value}
              unit={next.unit}
              sub={next.sub}
            />
          )}
        </HeroFigures>
        <HeroStats>
          <HeroStat
            label="Home use"
            value={kWh(d.load)}
            sub={d.soFar ? `${kWh(d.soFar.load)} so far` : "Your typical day"}
          />
          <HeroStat label={bat.label} value={bat.value} sub={bat.sub} />
          <HeroStat
            label="From the grid"
            value={d.imp < 0.05 ? "None" : kWh(d.imp)}
            sub={d.exp >= 0.05 ? `${kWh(d.exp)} sent back` : undefined}
          />
          {d.cost != null ? (
            <HeroStat
              label="Net cost"
              value={money(d.cost)}
              sub={d.cost < 0 ? "In credit after the supply charge" : "Supply charge less solar credit"}
            />
          ) : (
            <HeroStat
              label="Chance of rain"
              value={pct(d.day.precip)}
              sub={d.day.precip >= 40 ? "Lower solar" : undefined}
            />
          )}
        </HeroStats>
      </HeroTop>
      <SolarAgainstUse d={d} done={done} />
      {chart && times && (
        <PlanChart
          day={d}
          series={d.today ? plan.history?.series : undefined}
          now={now}
          soc0={d.today ? (plan.snapshot?.battery_soc ?? null) : null}
          reserve={plan.reserve}
          range={plan.range ? [plan.range.low, plan.range.high] : null}
          windows={[...times.spare, ...times.paid, ...times.avoid]}
          moments={events}
          rates={plan.rates}
          recordedSky={d.today ? plan.weatherToday?.hours : undefined}
        />
      )}
    </HeroCard>
  );
}

/**
 * The day's solar against what the house is expected to use, along one bar: made so far today (solid), what the
 * forecast expects (dashed) and the range it likely lands in (faint), with a tick for home use.
 */
function SolarAgainstUse({ d, done }: { d: PlanDay; done: boolean }) {
  const whole = Math.max(d.pv, d.load, d.pvRange?.[1] ?? 0, 0.1);
  const at = (v: number) => Math.min(100, (v / whole) * 100);
  const soFar = d.soFar?.pv ?? 0;
  return (
    <HeroBar
      legend={
        <>
          {d.today && (
            <HeroKey mark="dot" color={COLOR.solar}>
              {kWh(soFar)} made so far
            </HeroKey>
          )}
          {!done && (
            <HeroKey mark="dashed" color={COLOR.solar}>
              {d.pvRange
                ? `Likely ${d.pvRange[0].toFixed(1)} to ${kWh(d.pvRange[1])}`
                : `${kWh(d.pv)} ${d.today ? "by midnight" : "expected"}`}
            </HeroKey>
          )}
          <HeroKey mark="tick">{d.load > 0 ? `${kWh(d.load)} home use` : DASH}</HeroKey>
        </>
      }
    >
      {d.pvRange && !done && (
        <HeroFill from={at(d.pvRange[0])} to={at(d.pvRange[1])} color={COLOR.solar} variant="faint" />
      )}
      {!done && <HeroFill to={at(d.pv)} color={COLOR.solar} variant="dashed" />}
      {soFar > 0 && <HeroFill to={at(soFar)} color={COLOR.solar} />}
      <HeroTick at={at(d.load)} title="Home use" />
    </HeroBar>
  );
}
