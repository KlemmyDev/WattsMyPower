import { useMemo, type ReactNode } from "react";
import type { BatteryPlan, BatteryView, ControlRequest } from "~/features/battery/types";
import { isFull, KIND_COLOR } from "~/features/battery/utils";
import { inOutToday, levelOn } from "~/features/battery/utils/today";
import { batteryState, batteryTone, ON, reserveOf } from "~/features/common/energy/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { DASH, kW, kWh, pct } from "~/features/common/formatting/utils/number";
import type { BatteryMode, Snapshot, SystemInfo } from "~/features/common/live/types";
import type { HistorySeries } from "~/features/common/readings/types";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { useLiveDay } from "~/features/live/hooks";
import type { LiveHero, LiveMoment, Stat } from "~/features/live/types";
import { seriesAt, valueAt } from "~/features/live/utils/day";

type Supported = Extract<BatteryView, { supported: true }>;
type Line = [number, number][];

const DAY = 86_400;
const HOUR = 3600;

/**
 * Battery's part of the live pages' top card (LiveCard), under the sky with your battery in it: its title, a line on
 * what the battery's doing and what comes next, the day of its level as the chart (dashed on from now as things are
 * set, each hour in and out, the reserve; dragging along it moves the sky and the figures), and the figures: its level
 * with the reserve hatched and a tick at the lowest it'll get tonight, what's going in or out at the moment shown, what
 * went in and came out today, the lowest tonight and when it's full.
 *
 * `series` is the day's 5-minute readings the Battery page draws from (for where today's charge came from and went);
 * the level and power through the day come from the live pages' shared day.
 */
export function useBatteryHero({
  v,
  p,
  s,
  mode,
  series,
  preview,
  draft,
  forecastFull,
}: {
  v: Supported | undefined;
  p: Snapshot | null;
  s: SystemInfo | undefined;
  mode: BatteryMode | null;
  series: HistorySeries | undefined;
  /** What the control being set up would do, and its settings this moment (the Control card's), for the chart. */
  preview: BatteryPlan | null;
  draft: ControlRequest | null;
  /** When today's forecast says the battery fills (the forecast's summary, as Overview and Plan show it). */
  forecastFull: number | null;
}): LiveHero {
  const day = useLiveDay();
  const { now, start, rise, set, expected } = day;
  const scene = day.series;
  const io = useMemo(() => inOutToday(series, p), [series, p]);
  return useMemo(() => {
    const cap = s?.battery_kwh ?? 0;
    const c = v?.control && !v.control.ending ? v.control : null;
    const reserve = c?.kind === "floor" && c.floor != null ? c.floor : reserveOf(s);
    const top = v?.settings?.max_soc ?? 100;
    const outlook: Line = (v?.outlook?.points ?? []).filter(([t]) => t > now);
    // The level through the day: the readings so far, then what's expected as things are set.
    const past: Line = [];
    for (let i = 0; i < (scene?.t.length ?? 0); i++) {
      const soc = scene?.battery_soc?.[i];
      if (soc != null && scene!.t[i] <= now) past.push([scene!.t[i], soc]);
    }
    const line: Line = [...past, ...outlook];
    const levelAt = (t: number) =>
      t <= now + 60 ? (seriesAt(scene, "battery_soc", t) ?? levelOn(line, t)) : levelOn(outlook, t);
    const powerAt = (t: number): number | null => {
      if (t <= now + 60) return seriesAt(scene, "battery_power", t);
      const a = levelOn(outlook, t);
      const b = levelOn(outlook, t + 900);
      return a == null || b == null || !cap ? null : -(((b - a) / 100) * cap * 4 * 1000);
    };
    const pvAt = (t: number) => (t <= now + 60 ? seriesAt(scene, "pv_power", t) : valueAt(expected, t)) ?? 0;
    const after = (t: number) => line.filter(([x]) => x >= t);
    // The lowest it gets tonight: from sunset (or `t`, once it's later) until the sun's well up the next morning; before
    // then in the morning, until the sun's well up today.
    const lowest = (t: number, from: number | null) => {
      const morning = t < rise + 1.5 * HOUR;
      const a = morning ? t : Math.max(t, set - HOUR);
      const b = morning ? rise + 1.5 * HOUR : rise + DAY + 1.5 * HOUR;
      let best = from != null && a === t ? { lo: from, when: t } : null;
      for (const [x, lv] of after(a)) if (x <= b && (!best || lv < best.lo)) best = { lo: lv, when: x };
      return best;
    };
    const fullBy = (t: number) => after(t).find(([, lv]) => lv >= top - 1)?.[0] ?? null;
    const fullSince = (t: number) => {
      let since = t;
      for (let i = line.length - 1; i >= 0; i--) {
        const [x, lv] = line[i];
        if (x > t) continue;
        if (lv < top - 1) break;
        since = x;
      }
      return since;
    };
    const lastsUntil = (t: number) => after(t).find(([, lv]) => lv <= reserve + 0.5)?.[0] ?? null;
    // What went in and came out by `t`: the readings so far, then as expected.
    const inOutBy = (t: number) => {
      let charged = 0;
      let used = 0;
      const ts = scene?.t ?? [];
      for (let i = 0; i < ts.length; i++) {
        const w = scene?.battery_power?.[i];
        if (w == null || ts[i] >= Math.min(t, now)) continue;
        const h = Math.min(900, (ts[i + 1] ?? ts[i] + 300) - ts[i], Math.min(t, now) - ts[i]) / HOUR;
        if (w < -ON) charged += (-w / 1000) * h;
        else if (w > ON) used += (w / 1000) * h;
      }
      if (t > now && cap) {
        const pts = outlook.filter(([x]) => x <= t);
        for (let i = 1; i < pts.length; i++) {
          const dk = ((pts[i][1] - pts[i - 1][1]) / 100) * cap;
          if (dk > 0) charged += dk;
          else used -= dk;
        }
      }
      return { charged, used };
    };

    const at = (view: number, scrubbed: boolean): LiveMoment => {
      const ahead = view > now + 60;
      const when = hhmm(view);
      const soc = scrubbed ? levelAt(view) : (p?.battery_soc ?? null);
      const w = scrubbed ? powerAt(view) : (p?.battery_power ?? null);
      const st = batteryState(w);
      const ctl = scrubbed ? null : c;
      const full = st !== "charge" && st !== "discharge" && isFull(soc, top);
      const tint = st === "discharge" ? batteryTone(w) : ctl ? KIND_COLOR[ctl.kind] : COLOR.battery;
      const low = lowest(view, soc);
      // The same time Overview and Plan give, from the forecast, when it's still ahead; the chart's own line otherwise.
      const fb = full ? null : !scrubbed && forecastFull != null && forecastFull > view ? forecastFull : fullBy(view);
      const pv = scrubbed ? pvAt(view) : (p?.pv_power ?? 0);
      const [value, unit] = (w == null ? DASH : kW(Math.abs(w))).split(" ");
      const doing =
        st === "charge"
          ? "Charging"
          : st === "discharge"
            ? "Discharging"
            : full
              ? "Full"
              : soc == null
                ? ""
                : "Holding";
      const second = {
        label: scrubbed
          ? `${ahead ? "Likely " : ""}${ahead ? doing.toLowerCase() : doing} at ${when}`
          : ctl?.kind === "standby"
            ? "On standby"
            : st === "charge" || st === "discharge"
              ? `${doing} now`
              : full
                ? "Full"
                : "Idle",
        value,
        unit,
        sub:
          st === "charge"
            ? pv > ON
              ? "From spare solar"
              : "From the grid"
            : st === "discharge"
              ? "Running your home"
              : full
                ? pv > ON
                  ? "Full, spare solar goes to the grid"
                  : "Topped up"
                : soc != null && soc <= reserve + 1.5
                  ? "Holding its reserve"
                  : "Nothing in or out",
        live: !scrubbed && (st === "charge" || st === "discharge"),
        color: tint,
      };
      const by = scrubbed ? inOutBy(view) : { charged: io.charged, used: io.discharged };
      const stats: Stat[] = [
        {
          label: "Charged today",
          value: kWh(by.charged),
          sub: scrubbed
            ? `By ${when}`
            : io.charged < 0.05
              ? ""
              : io.grid < 0.05
                ? "All from solar"
                : io.solar < 0.05
                  ? "All from the grid"
                  : `${kWh(io.solar)} from solar`,
        },
        {
          label: "Used today",
          value: kWh(by.used),
          sub: scrubbed
            ? `By ${when}`
            : io.discharged < 0.05
              ? ""
              : io.out < 0.05
                ? "All to your home"
                : `${kWh(io.home)} to your home`,
        },
        {
          label: low && low.when <= now ? "Lowest so far" : "Forecast low",
          value: low ? pct(low.lo) : DASH,
          sub: low ? (low.when - view < 600 ? "Now" : `Around ${hhmm(low.when)}`) : "Needs a forecast",
        },
        full
          ? { label: "Full", value: "Now", sub: `Since ${hhmm(fullSince(view))}` }
          : fb != null
            ? {
                label: "Full by",
                value: hhmm(fb),
                sub: fb >= start + DAY ? "Tomorrow" : "Then solar goes to the grid",
              }
            : { label: "Full again", value: "Not by tomorrow", sub: "As things are set" },
      ];
      return {
        story: story({
          scrubbed,
          view,
          soc,
          w,
          st,
          full,
          pv,
          reserve,
          fb,
          low,
          until: lastsUntil(view),
          ctl,
          mode,
          rise,
        }),
        lead: {
          label: scrubbed ? `${ahead ? "Likely level at" : "Level at"} ${when}` : "Level",
          value: soc == null ? DASH : String(Math.round(soc)),
          unit: soc == null ? "" : "%",
        },
        slim: {
          label: `${pct(soc)} full, ${pct(reserve)} kept in reserve${low ? `, lowest ${pct(low.lo)} around ${hhmm(low.when)}` : ""}`,
          fill: soc ?? 0,
          color: tint,
          reserve,
          ticks: [
            ...(low ? [{ at: low.lo, color: COLOR.warn, title: "The lowest it's expected to get tonight" }] : []),
            ...(ctl?.kind === "charge" && ctl.target != null
              ? [{ at: ctl.target, color: KIND_COLOR.charge, title: "What it's charging to" }]
              : []),
          ],
        },
        second,
        stats,
      };
    };

    // The chart's lines and bars, worked out once per reading.
    const previewLine: Line = draft && preview ? preview.ahead.points.filter(([t]) => t >= now - 60) : [];
    const hours = hourly(scene, outlook, cap, start, now);
    return {
      page: "battery",
      title: "Battery",
      color: COLOR.battery,
      at,
      chart: (k) => (
        <BatteryChart
          past={past}
          outlook={outlook}
          preview={previewLine}
          hours={hours}
          reserve={reserve}
          start={start}
          rise={rise}
          set={set}
          view={k.view}
          level={k.scrubbed ? levelAt(k.view) : (p?.battery_soc ?? levelAt(now))}
          draining={batteryState(k.scrubbed ? powerAt(k.view) : p?.battery_power) === "discharge"}
          onScrub={k.onScrub}
          controls={k.controls}
        />
      ),
    };
  }, [v, p, s, mode, scene, expected, io, now, start, rise, set, preview, draft]);
}

/**
 * What the battery's doing at the moment shown, and what comes next, in a sentence: a control in effect or something
 * else that has it first (now only), then charging, running your home, full, or down to its reserve.
 */
function story(x: {
  scrubbed: boolean;
  view: number;
  soc: number | null;
  w: number | null;
  st: ReturnType<typeof batteryState>;
  full: boolean;
  pv: number;
  reserve: number;
  fb: number | null;
  low: { lo: number; when: number } | null;
  until: number | null;
  ctl: Supported["control"];
  mode: BatteryMode | null;
  rise: number;
}): string {
  const kw = x.w == null ? "" : kW(Math.abs(x.w)).replace(" ", "\u00a0"); // kept on one line
  if (x.ctl?.kind === "standby") return `On standby, holding its charge${x.soc != null ? ` at ${pct(x.soc)}` : ""}.`;
  if (x.ctl?.kind === "floor") return `Keeping ${pct(x.ctl.floor ?? x.reserve)} in reserve for now.`;
  if (x.ctl?.kind === "charge") return `Charging from the grid to ${pct(x.ctl.target ?? 100)}.`;
  if (!x.scrubbed && x.mode?.owner === "isolarcloud") return "iSolarCloud has the battery for now.";
  if (!x.scrubbed && (x.mode?.owner === "external" || x.mode?.owner === "elsewhere"))
    return "Something else has the battery for now.";
  if (x.soc == null) return "Waiting for the battery's first reading.";
  if (x.st === "charge") {
    const from = x.pv > ON ? `Charging from spare solar at ${kw}.` : `Charging from the grid at ${kw}.`;
    if (x.fb == null) return from;
    const plenty = x.low != null && x.low.lo > x.reserve + 10;
    return `${from} Full by about ${hhmm(x.fb)}${plenty ? ", with plenty for tonight." : "."}`;
  }
  if (x.st === "discharge")
    return x.until == null
      ? `Running your home at ${kw}, with plenty to get you to the morning.`
      : `Running your home at ${kw}. It should last until about ${hhmm(x.until)}.`;
  if (x.full)
    return x.pv > ON
      ? "Full and waiting. Spare solar is going to the grid until the evening."
      : "Full and waiting for the evening.";
  if (x.soc <= x.reserve + 1.5)
    return x.view < x.rise
      ? `Down to its ${pct(x.reserve)} reserve. The grid's running your home until the sun's up.`
      : `Down to its ${pct(x.reserve)} reserve. The grid's running your home for now.`;
  return `Resting at ${pct(x.soc)}. Nothing's going in or out right now.`;
}

type Hour = { t: number; in: number; out: number; ahead: boolean };

/** Each hour's kWh in and out of the battery: from the readings so far, then from how the expected level rises and falls. */
function hourly(scene: HistorySeries | undefined, outlook: Line, cap: number, start: number, now: number): Hour[] {
  const out: Hour[] = [];
  const ts = scene?.t ?? [];
  for (let t = start; t < start + DAY; t += HOUR) {
    if (t < now) {
      const h: Hour = { t, in: 0, out: 0, ahead: false };
      for (let i = 0; i < ts.length; i++) {
        const w = scene?.battery_power?.[i];
        if (w == null || ts[i] < t || ts[i] >= t + HOUR) continue;
        const k = (Math.abs(w) / 1000) * (Math.min(900, (ts[i + 1] ?? ts[i] + 300) - ts[i]) / HOUR);
        if (w < -ON) h.in += k;
        else if (w > ON) h.out += k;
      }
      out.push(h);
    } else if (cap) {
      const a = levelOn(outlook, t);
      const b = levelOn(outlook, t + HOUR);
      if (a != null && b != null) {
        const k = ((b - a) / 100) * cap;
        out.push({ t, in: Math.max(0, k), out: Math.max(0, -k), ahead: true });
      }
    }
  }
  return out;
}

const W = 1000;
const H = 220;

/**
 * The battery's day under the sky, midnight to midnight: its level so far (a line over a fill) and on from now as
 * things are set (dashed), what the control being set up would make of it (dotted), each hour in (blue) and out
 * (amber) along the bottom, and the reserve. Drag along it (or use the arrow keys) to move the whole scene to that
 * moment. The lines are drawn once per reading; scrubbing only moves the marker.
 */
function BatteryChart({
  past,
  outlook,
  preview,
  hours,
  reserve,
  start,
  rise,
  set,
  view,
  level,
  draining,
  onScrub,
  controls,
}: {
  past: Line;
  outlook: Line;
  preview: Line;
  hours: Hour[];
  reserve: number;
  start: number;
  rise: number;
  set: number;
  view: number;
  level: number | null;
  draining: boolean;
  onScrub: (t: number) => void;
  controls: ReactNode;
}) {
  const pc = (t: number) => `${((t - start) / DAY) * 100}%`;
  const Y = (v: number) => H - (Math.max(0, Math.min(100, v)) / 100) * (H - 24);
  const lines = useMemo(() => {
    const X = (t: number) => ((t - start) / DAY) * W;
    const path = (pts: Line) =>
      pts.map(([t, v], i) => `${i ? "L" : "M"}${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
    const end = start + DAY;
    const shown = (pts: Line) => pts.filter(([t]) => t >= start && t <= end);
    const solid = path(shown(past));
    const lastPast = past[past.length - 1];
    const dashed = path(shown(lastPast ? [lastPast, ...outlook] : outlook));
    const area =
      solid && lastPast ? `${solid} L${X(lastPast[0]).toFixed(1)},${H} L${X(past[0][0]).toFixed(1)},${H} Z` : "";
    const top = Math.max(0.5, ...hours.map((h) => Math.max(h.in, h.out)));
    const bar = (h: Hour, k: number) => {
      const tall = (k / top) * (H - 24) * 0.42;
      return { x: X(h.t) + 5, y: H - tall, width: W / 24 - 10, height: tall };
    };
    return (
      <svg
        aria-hidden
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="absolute inset-x-0 bottom-[26px] h-[108px] w-full overflow-visible max-sm:h-[86px]"
      >
        <defs>
          <linearGradient id="sky-battery" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-battery)" stopOpacity={0.32} />
            <stop offset="1" stopColor="var(--color-battery)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {hours.map((h) => (
          <g key={`${h.t}${h.ahead}`} opacity={h.ahead ? 0.5 : 1}>
            {h.in >= 0.02 && <rect {...bar(h, h.in)} rx={2} style={{ fill: alpha(COLOR.battery, 0.32) }} />}
            {h.out >= 0.02 && <rect {...bar(h, h.out)} rx={2} style={{ fill: alpha(COLOR.solar, 0.42) }} />}
          </g>
        ))}
        <line
          x1={0}
          x2={W}
          y1={Y(reserve)}
          y2={Y(reserve)}
          strokeDasharray="2 4"
          vectorEffect="non-scaling-stroke"
          style={{ stroke: alpha(COLOR.fg, 0.35) }}
        />
        {area && <path d={area} fill="url(#sky-battery)" />}
        {dashed && (
          <path
            d={dashed}
            fill="none"
            strokeWidth={1.8}
            strokeDasharray="4 5"
            opacity={0.75}
            vectorEffect="non-scaling-stroke"
            style={{ stroke: COLOR.battery }}
          />
        )}
        {preview.length > 1 && (
          <path
            d={path(shown(preview))}
            fill="none"
            strokeWidth={2.5}
            strokeDasharray="1 5"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            style={{ stroke: COLOR.batterySoft }}
          />
        )}
        {solid && (
          <path
            d={solid}
            fill="none"
            strokeWidth={2.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={{ stroke: COLOR.battery }}
          />
        )}
      </svg>
    );
  }, [past, outlook, preview, hours, reserve, start]);
  const dot = draining ? COLOR.solar : COLOR.battery;

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
        <span
          className="absolute right-0 -translate-y-full pb-0.5 text-[10.5px] text-ink-faint max-sm:hidden"
          style={{ top: `${(Y(reserve) / H) * 100}%` }}
        >
          Reserve {pct(reserve)}
        </span>
        <span className="absolute inset-y-0 w-px bg-ink/55" style={{ left: pc(view) }} />
        {level != null && (
          <span
            className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface transition-colors duration-300"
            style={{
              left: pc(view),
              top: `${(Y(level) / H) * 100}%`,
              background: dot,
              boxShadow: `0 0 0 4px ${alpha(dot, 0.28)}, 0 0 16px ${dot}`,
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
