import type { ReactNode } from "react";
import { hhmm } from "~/features/common/formatting/utils/date";
import { DASH, kW, kWh, money, pct, signedPct } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, midnight, mondayFirst } from "~/features/common/time/utils";
import { TooltipRow } from "~/features/common/ui/components/ChartHover";
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
import { Delta } from "~/features/common/ui/components/Live";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { TimeLine, type LinePoint } from "~/features/common/ui/components/TimeLine";
import { WEEKDAY_LONG } from "~/features/home/components/Analysis";
import { LaneRows, Lanes } from "~/features/home/components/HomeHero";
import type { DevicePattern, HomeDevice, HomeInsights, HomeProfile, HomeUsage } from "~/features/home/types";
import { watts } from "~/features/home/utils";
import type { Lane } from "~/features/home/utils/today";

const USUAL = alpha(COLOR.fg, 0.45);

/** What it's doing now, for the hero's live figure. */
export type ItemLive = {
  /** What it's drawing (W), when it's drawing anything to speak of. */
  w: number | null;
  /** `w` is what its runs usually draw, not a reading. */
  estimated: boolean;
  running: boolean;
  /** In place of a figure while it isn't drawing: "Idle", "Offline". */
  quiet: string;
  /** What it's doing in a few words ("Rinse · 23 min left", "2 of 3 on"). */
  status: ReactNode;
  /** Its switch, for a device that has one. */
  control?: ReactNode;
};

/**
 * A room's or a device's top card, as Home's is for the house, washed in its own colour: what it's used today and where
 * that's heading by midnight (against its usual day by now), what it's drawing now (against its usual draw at this
 * time, with its switch), up to four figures that round it out (`stats`), today's pace along a bar, and, unless `chart`
 * is off, its day against a usual one with a lane per device (`lanes`) under it.
 */
export function ItemHero({
  name,
  color,
  profile: p,
  now,
  live,
  stats,
  lanes = [],
  chart = true,
}: {
  name: string;
  color: string;
  /** Its use together, looked at closely (homeProfileQuery); undefined while it loads. */
  profile: HomeProfile | undefined;
  now: number;
  live: ItemLive;
  /** HeroStat figures, up to four. */
  stats: ReactNode;
  lanes?: Lane[];
  chart?: boolean;
}) {
  const start = midnight(now);
  const t = p?.today;
  const u = t?.usual;
  const known = !!p && p.days > 0 && !!u;
  const day = u?.same_weekday ? `a usual ${WEEKDAY_LONG[mondayFirst(start)]}` : "a usual day";
  const pace = known && u.by_now > 0.01 ? t!.kwh / u.by_now - 1 : null;
  const [usedValue, usedUnit] = t ? kWh(t.kwh).split(" ") : [DASH];
  // What it usually draws in the slot of the day it is now, to set what it's drawing against.
  const usualW = known && u.w.length ? (u.w[Math.floor((now - start) / u.slot)] ?? null) : null;
  const vsUsual = live.w != null && usualW != null && usualW > 20 ? live.w / usualW - 1 : null;
  const [liveValue, liveUnit] = live.w != null ? watts(live.w, live.estimated).split(" ") : [live.quiet];
  const points: LinePoint[] = t ? t.t.map((ts, i) => ({ t: ts + 150, v: t.w[i] })) : [];
  const usual: LinePoint[] = known ? u.w.map((w, i) => ({ t: start + i * u.slot + u.slot / 2, v: w })) : [];
  return (
    <HeroCard label={`${name} today and now`} tint={color}>
      <HeroTop>
        <HeroFigures>
          <HeroLead
            label="Used today"
            value={usedValue}
            unit={usedUnit}
            sub={
              !p ? undefined : !known ? (
                "Its usual day shows after a day of readings"
              ) : (
                <>
                  {t!.by_midnight != null && t!.by_midnight >= 0.01
                    ? `Heading for ${kWh(t!.by_midnight)} by midnight`
                    : t!.kwh < 0.005 && "Nothing used yet today"}
                  {pace != null && (
                    <Delta value={pace} invert>
                      {signedPct(pace)} on {day}
                    </Delta>
                  )}
                </>
              )
            }
          />
          <HeroLive
            label={live.running ? "Running now" : "Drawing now"}
            on={live.running || live.w != null}
            color={color}
            value={liveValue}
            unit={liveUnit}
            sub={
              <>
                {live.status}
                {vsUsual != null && (
                  <Delta value={vsUsual} invert>
                    {signedPct(vsUsual)} on usual
                  </Delta>
                )}
                {live.control}
              </>
            }
          />
        </HeroFigures>
        <HeroStats>{stats}</HeroStats>
      </HeroTop>
      {known && Math.max(u.kwh, t!.kwh) >= 0.01 && (
        <Pace color={color} used={t!.kwh} usualNow={u.by_now} usualDay={u.kwh} heading={t!.by_midnight} day={day} />
      )}
      {chart &&
        (p ? (
          <TimeLine
            label={`${name}'s power through today, against ${day}`}
            points={points}
            compare={known ? { points: usual, color: USUAL } : undefined}
            start={start}
            end={addDays(start, 1)}
            now={now}
            color={color}
            fill
            height={220}
            domain={[0, 100]}
            every={3}
            empty="No readings yet today."
            tip={(pt, other) => (
              <>
                <span className="font-medium text-ink">{hhmm(pt.t)}</span>
                {pt.v != null && <TooltipRow label="Today" value={kW(pt.v)} color={color} />}
                {other?.v != null && <TooltipRow label="Usual" value={kW(other.v)} color={USUAL} />}
                <LaneRows lanes={lanes} t={pt.t} />
              </>
            )}
            under={
              lanes.length > 1
                ? (a, b, hover) => <Lanes lanes={lanes} from={a} to={b} now={now} hover={hover} by="device" />
                : undefined
            }
          />
        ) : (
          <Skeleton className="h-[260px] rounded-2xl" />
        ))}
    </HeroCard>
  );
}

/**
 * Today's pace along one bar out of where it's heading: used so far, the rest a usual pace would add (dashed), a tick
 * for what its usual day has used by now and a fainter one for its whole usual day.
 */
function Pace({
  color,
  used,
  usualNow,
  usualDay,
  heading,
  day,
}: {
  color: string;
  used: number;
  usualNow: number;
  usualDay: number;
  heading: number | null;
  /** The usual day, in words: "a usual Monday". */
  day: string;
}) {
  const whole = Math.max(heading ?? 0, usualDay, used, 0.01);
  const at = (v: number) => Math.min(100, (v / whole) * 100);
  return (
    <HeroBar
      legend={
        <>
          <HeroKey mark="dot" color={color}>
            Used so far
          </HeroKey>
          <HeroKey mark="tick">{kWh(usualNow)} usual by now</HeroKey>
          <HeroKey mark="tick" color={alpha(COLOR.fg, 0.4)}>
            {kWh(usualDay)} on {day}
          </HeroKey>
          {heading != null && (
            <HeroKey mark="dashed" color={color}>
              {kWh(heading)} by midnight
            </HeroKey>
          )}
        </>
      }
    >
      {heading != null && <HeroFill to={at(heading)} color={color} variant="dashed" />}
      <HeroFill to={at(used)} color={color} />
      <HeroTick at={at(usualNow)} title="Its usual day by now" />
      <HeroTick at={at(usualDay)} color={alpha(COLOR.fg, 0.4)} title="Its usual whole day" />
    </HeroBar>
  );
}

/** "Today", "Tomorrow" or the weekday a time falls on. */
function dayWord(ts: number, now: number) {
  const today = midnight(now);
  if (ts < addDays(today, 1)) return "Today";
  if (ts < addDays(today, 2)) return "Tomorrow";
  return WEEKDAY_LONG[mondayFirst(ts)];
}

/** Standby power as shown: "3.7 W", "12 W". */
const standbyW = (w: number) => (w < 10 ? `${w.toFixed(1)} W` : kW(w));

/**
 * The hero's four figures for a room or a device (`members`), the most useful first: what it's cost today, its runs
 * today against a usual run (for an appliance that runs in cycles), what it draws all the time, and when best to run
 * it next; where one of those has nothing to say, its peak today and its share of the home's use fill in.
 */
export function itemStats({
  members,
  today,
  profile,
  patterns,
  found,
  kinds,
  now,
}: {
  members: HomeDevice[];
  /** Today hour by hour (homeUsageQuery). */
  today: HomeUsage | undefined;
  profile: HomeProfile | undefined;
  patterns: DevicePattern[] | undefined;
  found: HomeInsights | undefined;
  kinds: Map<string, { cycles: boolean }>;
  now: number;
}): ReactNode[] {
  const many = members.length > 1;
  const ids = new Set(members.map((d) => d.id));
  const name = (id: number) => members.find((d) => d.id === id)?.name ?? "";
  const used = today?.devices.filter((u) => ids.has(u.id)) ?? [];
  const kwh = used.reduce((a, u) => a + u.total, 0);
  const cost = used.reduce((a, u) => a + u.cost, 0);
  const sunKwh = used.reduce((a, u) => a + u.total * (u.solar_share ?? 0), 0);
  const stats: ReactNode[] = [
    <HeroStat
      key="cost"
      label="Cost today"
      value={today ? money(cost) : DASH}
      sub={kwh > 0.01 ? `${pct((sunKwh / kwh) * 100)} from solar` : undefined}
    />,
  ];
  const cyclers = members.filter((d) => kinds.get(d.kind)?.cycles);
  if (cyclers.length) {
    const runs = used.filter((u) => cyclers.some((d) => d.id === u.id)).reduce((a, u) => a + u.runs, 0);
    const mine = cyclers.map((d) => patterns?.find((x) => x.id === d.id)).filter((x) => x != null);
    const p = cyclers.length === 1 ? mine[0] : undefined;
    // How often they run together, from their last eight weeks.
    const weekly = mine.reduce((a, x) => a + (x.days >= 7 ? x.runs / (x.days / 7) : 0), 0);
    stats.push(
      <HeroStat
        key="runs"
        label="Runs today"
        value={today ? runs : DASH}
        sub={
          p?.run_kwh != null
            ? `Usually ${[kWh(p.run_kwh), p.run_minutes != null && `${Math.round(p.run_minutes)} min`].filter(Boolean).join(", ")}`
            : weekly >= 0.5
              ? `About ${Math.round(weekly)} a week`
              : undefined
        }
      />,
    );
  }
  const standby = found?.standby.devices.filter((x) => ids.has(x.id)) ?? [];
  const alwaysW = standby.reduce((a, x) => a + x.w, 0);
  if (alwaysW >= 0.5)
    stats.push(
      <HeroStat
        key="standby"
        label="Always on"
        value={standbyW(alwaysW)}
        sub={`About ${money(standby.reduce((a, x) => a + x.yearly_cost, 0))} a year`}
      />,
    );
  const best = found?.best_times.filter((b) => ids.has(b.id)).sort((a, b) => a.start - b.start)[0];
  if (best) {
    const solar = Math.round(best.solar_share * 100);
    const how =
      best.why === "cheapest"
        ? "cheapest from the grid"
        : solar >= 95
          ? "all on spare solar"
          : `${solar}% on spare solar`;
    stats.push(
      <HeroStat
        key="best"
        label="Best time to run"
        value={`${hhmm(best.start)}–${hhmm(best.end)}`}
        sub={`${dayWord(best.start, now)}${many ? `, ${name(best.id)}` : ""} · ${how}`}
      />,
    );
  }
  const peak = profile?.peak_today;
  if (stats.length < 4 && peak)
    stats.push(
      <HeroStat
        key="peak"
        label="Peak today"
        value={kW(peak.w)}
        sub={`At ${hhmm(peak.ts)}${many ? `, ${name(peak.device)}` : ""}`}
      />,
    );
  const home = today?.total.home;
  if (stats.length < 4 && home)
    stats.push(
      <HeroStat key="share" label="Share of your home" value={pct((kwh / home) * 100)} sub="Of today's use" />,
    );
  return stats.slice(0, 4);
}
