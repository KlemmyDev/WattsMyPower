import { useQuery } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { levelOn } from "~/features/battery/utils/today";
import { hhmm } from "~/features/common/formatting/utils/date";
import { DASH, kW, kWh, pct } from "~/features/common/formatting/utils/number";
import type { HistorySeries } from "~/features/common/readings/types";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays } from "~/features/common/time/utils";
import { levelsQuery } from "~/features/ev/api";
import type { EvBrand, EvLevels, EvVehicle } from "~/features/ev/types";
import { carMood, carTitle } from "~/features/ev/utils";
import { homeUsageQuery } from "~/features/home/api";
import { useLiveDay } from "~/features/live/hooks";
import type { LiveHero, LiveMoment, Stat } from "~/features/live/types";

const DAY = 86_400;
const ROLLUP_KWH = 5 / 60 / 1000; // each of the car's power readings is five minutes' average (W)

type Line = [number, number][];

/**
 * EV's part of the live pages' top card (LiveCard), under the sky with your car in it (on the driveway, or in the
 * garage when you park it there; not while it's out): its name, a line on what it's doing and what's next, its level
 * through the day as the chart (with what it drew from the house each five minutes over the day's sun, and its charge
 * limit; dragging along it moves the sky and the figures), and the figures: its charge with its limit dashed ahead,
 * what it's charging at now (or that it's plugged in, or away), what it took at home today and how much of it was sun,
 * its range and its limit.
 *
 * A Tesla's day comes from its own readings; a Hyundai or Kia's figures, when it's the only car, from what the house
 * saw go to the car, and otherwise as it is now. Null without a car.
 */
export function useEvHero({
  v,
  brand,
  alone,
}: {
  v: EvVehicle | null;
  brand: EvBrand;
  /** It's the only car connected: what the house saw go to cars today is all its own. */
  alone: boolean;
}): LiveHero | null {
  const day = useLiveDay();
  const { now, start, rise, set } = day;
  const end = addDays(start, 1);
  const { data: levels } = useQuery({ ...levelsQuery(v?.vin ?? "", start, end), enabled: !!v && brand === "tesla" });
  const { data: usage } = useQuery({ ...homeUsageQuery(start, end, "hour"), enabled: !!v && alone });
  return useMemo(() => {
    if (!v) return null;
    const s = v.state;
    const lv = levels && levels.start === start ? levels : null;
    const limit = s?.limit != null ? Math.round(s.limit) : null;
    const solar = v.control.mode === "solar";
    const points: Line = (lv?.points ?? []).map((x) => [x.t, x.soc]);
    const homeAt = (t: number) => !lv || !lv.away.some((a) => a.start <= t && t < a.end);
    const drawAt = (t: number) => lv?.power.find((r) => r.t <= t && t < r.t + 300) ?? null;
    // What it took at home by `t`, and of it from the grid (kWh): its own readings; else what the house saw.
    const takenBy = (t: number) => {
      if (!lv) {
        const house = alone ? usage?.car : null;
        const kwh = house?.total ?? null;
        return { kwh, grid: kwh != null && house?.solar_share != null ? kwh * (1 - house.solar_share) : null };
      }
      const rs = lv.power.filter((r) => r.t < t);
      return {
        kwh: rs.reduce((a, r) => a + r.w, 0) * ROLLUP_KWH,
        grid: rs.reduce((a, r) => a + r.grid_w, 0) * ROLLUP_KWH,
      };
    };
    const today = takenBy(now);

    const at = (view: number, scrubbed: boolean): LiveMoment => {
      const past = scrubbed && view <= now + 60;
      const when = hhmm(view);
      const home = past ? homeAt(view) : s?.at_home !== false;
      const soc = past ? (levelOn(points, view) ?? s?.soc ?? null) : (s?.soc ?? null);
      const r = past ? drawAt(view) : null;
      const kw = past ? (r?.w ?? 0) / 1000 : home && s?.charging ? (s.power_kw ?? 0) : 0;
      const sunShare = past
        ? r && r.w > 50
          ? Math.max(0, 1 - r.grid_w / r.w)
          : null
        : today.kwh && today.grid != null && today.kwh >= 0.05
          ? Math.max(0, 1 - today.grid / today.kwh)
          : null;
      const charging = home && kw > 0.05;
      const plugged = home && (s?.plugged ?? false);
      const doing = !home ? "Away" : charging ? "Charging" : plugged ? "Plugged in" : "Parked";
      const by = scrubbed ? takenBy(Math.min(view, now)) : today;
      const added = by.kwh ?? 0;
      const fromSun = by.kwh != null && by.grid != null && added >= 0.05 ? Math.max(0, added - by.grid) : null;
      const range = s?.range_km != null && s.soc ? (s.range_km / s.soc) * (soc ?? s.soc) : null;
      const mood = carMood({ status: v.status, mode: v.control.mode, asleep: s?.asleep, charging: s?.charging });
      const tint = charging ? mood.color : COLOR.battery;
      const [value, unit] = kW(kw * 1000).split(" ");
      const stats: Stat[] = [
        {
          label: "Added today",
          value: by.kwh == null ? DASH : kWh(added),
          sub: scrubbed ? `By ${when}` : added < 0.05 ? "Nothing yet" : "At home",
        },
        {
          label: "From the sun",
          value: fromSun != null ? pct((fromSun / added) * 100) : added < 0.05 ? "None yet" : DASH,
          sub: fromSun != null ? `${kWh(fromSun)} of it` : "Not charged today",
        },
        {
          label: "Range",
          value: range != null ? `${Math.round(range)} km` : DASH,
          sub: soc != null ? `At ${pct(soc)}` : undefined,
        },
        {
          label: "Charge limit",
          value: limit != null ? pct(limit) : DASH,
          sub:
            !scrubbed && charging && s?.minutes_to_full
              ? `Reached by ${hhmm(now + s.minutes_to_full * 60)}`
              : "Set for this car",
        },
      ];
      return {
        story: story({ v, home, charging, plugged, soc, kw, sunShare, range, added, fromSun, solar, limit, view }),
        lead: {
          label: scrubbed ? `${view > now + 60 ? "Likely charge at" : "Charge at"} ${when}` : "Charge",
          value: soc == null ? DASH : String(Math.round(soc)),
          unit: soc == null ? "" : "%",
        },
        slim: {
          label: `${pct(soc)} charged${limit != null ? `, charges to ${pct(limit)}` : ""}`,
          fill: soc ?? 0,
          color: tint,
          ahead: limit ?? undefined,
          ticks: [],
        },
        second: {
          label: scrubbed ? `${doing} at ${when}` : `${doing}${home ? " now" : ""}`,
          value,
          unit,
          sub: !home
            ? "Away from home"
            : charging
              ? sunShare != null
                ? `${pct(sunShare * 100)} from your panels`
                : "At home"
              : plugged
                ? solar
                  ? "Waiting for spare sun"
                  : "Not charging"
                : "Not plugged in",
          live: !scrubbed && charging,
          color: tint,
        },
        stats,
        car: { home, kw },
      };
    };
    return {
      page: "ev",
      title: v.name || carTitle(v),
      color: COLOR.danger,
      car: v.vin,
      at,
      chart: (k) => (
        <EvChart
          points={points}
          levels={lv}
          series={day.series}
          limit={limit}
          start={start}
          rise={rise}
          set={set}
          view={k.view}
          level={k.scrubbed && k.view <= now + 60 ? levelOn(points, k.view) : (s?.soc ?? null)}
          onScrub={k.onScrub}
          controls={k.controls}
        />
      ),
    };
  }, [v, levels, usage, alone, now, start, rise, set, day.series]);
}

/** What the car's doing at the moment shown, and what's next, in a sentence. */
function story(x: {
  v: EvVehicle;
  home: boolean;
  charging: boolean;
  plugged: boolean;
  soc: number | null;
  kw: number;
  sunShare: number | null;
  range: number | null;
  added: number;
  fromSun: number | null;
  solar: boolean;
  limit: number | null;
  view: number;
}): string {
  if (x.soc == null && x.home) return "Waiting for the car's first reading.";
  if (!x.home) return x.solar ? "The car's out. It'll top up from spare sun when it's back." : "The car's out.";
  const level = pct(x.soc);
  if (x.charging) {
    const kw = kW(x.kw * 1000).replace(" ", " "); // kept on one line
    const sun = x.sunShare != null ? `, ${pct(x.sunShare * 100)} of it from your panels` : "";
    const range = x.range != null ? `, about ${Math.round(x.range)} km` : "";
    return `Charging at ${kw}${sun}. ${level} now${range}.`;
  }
  if (!x.plugged) return `Parked at ${level}, not plugged in.`;
  if (x.added > 0.1 && x.limit != null && (x.soc ?? 0) >= x.limit - 1)
    return `Done for today at ${level}. It added ${kWh(x.added)}${x.fromSun != null ? `, ${pct((x.fromSun / x.added) * 100)} of it from the sun` : ""}.`;
  if (x.solar && x.v.solar_from != null && x.v.solar_from > x.view)
    return `Plugged in at ${level}. It starts charging once there's spare sun, around ${hhmm(x.v.solar_from)}.`;
  if (x.solar) return `Plugged in at ${level}. There's not enough spare sun today, so it'll wait for tomorrow's.`;
  return `Plugged in at ${level}, not charging.`;
}

const W = 1000;
const H = 220;

/**
 * The car's day under the sky, midnight to midnight: its level (a line), what it drew from the house each five minutes
 * (a green area) over the day's sun (faint), and its charge limit. Drag along it (or use the arrow keys) to move the
 * whole scene to that moment. The lines are drawn once per reading; scrubbing only moves the marker.
 */
function EvChart({
  points,
  levels,
  series,
  limit,
  start,
  rise,
  set,
  view,
  level,
  onScrub,
  controls,
}: {
  points: Line;
  levels: EvLevels | null;
  series: HistorySeries | undefined;
  limit: number | null;
  start: number;
  rise: number;
  set: number;
  view: number;
  level: number | null;
  onScrub: (t: number) => void;
  controls: ReactNode;
}) {
  const pc = (t: number) => `${((t - start) / DAY) * 100}%`;
  const Y = (v: number) => H - (Math.max(0, Math.min(100, v)) / 100) * (H - 24);
  const lines = useMemo(() => {
    const X = (t: number) => ((t - start) / DAY) * W;
    const Yl = (v: number) => H - (Math.max(0, Math.min(100, v)) / 100) * (H - 24);
    const ts = series?.t ?? [];
    const pv = series?.pv_power ?? [];
    const power = levels?.power ?? [];
    const top = Math.max(7000, ...pv.map((x) => x ?? 0), ...power.map((r) => r.w)) * 1.05;
    const Yw = (w: number) => H - (w / top) * (H - 24) * 0.9;
    let sun = "";
    ts.forEach((t, i) => {
      const w = pv[i];
      if (w != null) sun += `${sun ? "L" : "M"}${X(t).toFixed(1)},${Yw(w).toFixed(1)}`;
    });
    const sunArea =
      sun && ts.length ? `${sun} L${X(ts[ts.length - 1]).toFixed(1)},${H} L${X(ts[0]).toFixed(1)},${H} Z` : "";
    const draw = power
      .map((r) => `M${X(r.t).toFixed(1)},${H} V${Yw(r.w).toFixed(1)} H${X(r.t + 300).toFixed(1)} V${H} Z`)
      .join("");
    const line = points.map(([t, v], i) => `${i ? "L" : "M"}${X(t).toFixed(1)},${Yl(v).toFixed(1)}`).join(" ");
    return (
      <svg
        aria-hidden
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="absolute inset-x-0 bottom-[26px] h-[108px] w-full overflow-visible max-sm:h-[86px]"
      >
        {sunArea && <path d={sunArea} style={{ fill: alpha(COLOR.solar, 0.1) }} />}
        {draw && <path d={draw} style={{ fill: alpha(COLOR.good, 0.5) }} />}
        {limit != null && (
          <line
            x1={0}
            x2={W}
            y1={Yl(limit)}
            y2={Yl(limit)}
            strokeDasharray="2 4"
            vectorEffect="non-scaling-stroke"
            style={{ stroke: alpha(COLOR.fg, 0.35) }}
          />
        )}
        {line && (
          <path
            d={line}
            fill="none"
            strokeWidth={2.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={{ stroke: COLOR.battery }}
          />
        )}
      </svg>
    );
  }, [points, levels, series, limit, start]);

  return (
    <div className="relative h-[134px] max-sm:h-[112px]">
      {[rise, set].map((t, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute top-0 bottom-[26px] border-l border-dashed"
          style={{ left: pc(t), borderColor: i ? "rgb(255 150 110 / 0.35)" : "rgb(255 190 110 / 0.35)" }}
        />
      ))}
      {lines}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-[26px] h-[108px] max-sm:h-[86px]">
        {limit != null && (
          <span
            className="absolute right-0 -translate-y-full pb-0.5 text-[10.5px] text-ink-faint max-sm:hidden"
            style={{ top: `${(Y(limit) / H) * 100}%` }}
          >
            Limit {pct(limit)}
          </span>
        )}
        <span className="absolute inset-y-0 w-px bg-ink/55" style={{ left: pc(view) }} />
        {level != null && (
          <span
            className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface"
            style={{
              left: pc(view),
              top: `${(Y(level) / H) * 100}%`,
              background: COLOR.battery,
              boxShadow: `0 0 0 4px ${alpha(COLOR.battery, 0.28)}, 0 0 16px ${COLOR.battery}`,
            }}
          />
        )}
      </div>
      <input
        type="range"
        aria-label="Move through today"
        aria-valuetext={hhmm(view)}
        min={0}
        max={287}
        step={1}
        value={Math.min(287, Math.round((view - start) / 300))}
        onChange={(e) => onScrub(start + Number(e.target.value) * 300)}
        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
      />
      <div className="absolute top-0 left-0 z-2 flex items-center gap-2">{controls}</div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[26px] text-xs text-ink-faint tabular-nums"
      >
        <span className="absolute top-[7px] left-0 max-sm:hidden">Midnight</span>
        <span className="absolute top-[7px] -translate-x-1/2 text-solar" style={{ left: pc(rise) }}>
          Sunrise {hhmm(rise)}
        </span>
        <span className="absolute top-[7px] left-1/2 -translate-x-1/2 max-sm:hidden">Noon</span>
        <span className="absolute top-[7px] -translate-x-1/2 text-solar-deep" style={{ left: pc(set) }}>
          Sunset {hhmm(set)}
        </span>
        <span className="absolute top-[7px] right-0 max-sm:hidden">Midnight</span>
      </div>
    </div>
  );
}
