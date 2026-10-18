import { useQuery } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { useAmberPrices } from "~/features/amber/hooks";
import { ON } from "~/features/common/energy/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { centsShort, DASH, kW, kWh, money } from "~/features/common/formatting/utils/number";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import { costsQuery } from "~/features/common/readings/api";
import type { HistorySeries } from "~/features/common/readings/types";
import type { RateRun } from "~/features/common/tariffs/utils";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { dateKey, midnight } from "~/features/common/time/utils";
import { useUsualImport } from "~/features/grid/hooks";
import type { ForecastHour, Forecast } from "~/features/common/weather/types";
import type { GridView } from "~/features/grid/types";
import { LEVEL, wholesaleKind } from "~/features/grid/utils";
import { rateAt } from "~/features/home/components/RateStrip";
import { useRates } from "~/features/home/hooks";
import { useLiveDay } from "~/features/live/hooks";
import type { LiveHero, LiveMoment, Stat } from "~/features/live/types";
import { seriesAt } from "~/features/live/utils/day";

const DAY = 86_400;
const HOUR = 3600;
const HALF = 1800;
/** Below this a price is cheap, at or above `DEAR` it's the peak (dollars a kWh). */
const CHEAP = 0.18;
const DEAR = 0.3;

/**
 * Grid's part of the live pages' top card (LiveCard), under the sky with the street, its poles and the line to your
 * meter in it: its title, a line on what you're buying or selling and at what price, power to and from the grid through
 * the day as the chart (buying above the line, selling below, the rest of today as the forecast has it dashed, with
 * the wholesale price of each half hour under it, or your rates while AEMO isn't followed; dragging along
 * it moves the sky and the figures), and the figures: what today's cost so far (counted up, with the supply charge, as
 * Today so far has it), what's flowing now, what you bought and sold, the price now and the voltage at your house.
 *
 * `series` is the grid's day as the Grid page reads it (power and voltage every 5 minutes).
 */
export function useGridHero({
  grid,
  p,
  s,
  series,
  f,
}: {
  grid: GridView | undefined;
  p: Snapshot | null;
  s: SystemInfo | undefined;
  series: HistorySeries | undefined;
  f?: Forecast | null;
}): LiveHero {
  const { now, start, rise, set } = useLiveDay();
  const { data: costs } = useQuery(costsQuery(midnight(now)));
  const bill = costs?.days.find((d) => d.date === dateKey(now)) ?? null;
  const rates = useRates(start);
  const amber = useAmberPrices(start, s?.tariff?.type === "amber");
  const usual = useUsualImport(now);
  const level = grid?.outlook.level ?? "normal";
  const reason = grid?.outlook.reasons[0]?.title ?? null;
  return useMemo(() => {
    const fit = s?.tariff && s.tariff.type !== "amber" && s.tariff.feed_in_rate !== "" ? +s.tariff.feed_in_rate : null;
    /** What a kWh sold earns at `t` ($): Amber's feed-in price, else your feed-in tariff. */
    const feedAt = (t: number) => amber?.feed_in.find((x) => x.start <= t && t < x.end)?.rate ?? fit;
    // What was bought and sold by `t`, and what it cost and earned: from the 5-minute readings at the price of the time.
    const ts = series?.t ?? [];
    const byT = (t: number) => {
      let imp = 0;
      let exp = 0;
      let cost = 0;
      let earn = 0;
      for (let i = 0; i < ts.length; i++) {
        const w = series?.grid_power?.[i];
        if (w == null || ts[i] >= Math.min(t, now)) continue;
        const h = Math.min(900, (ts[i + 1] ?? ts[i] + 300) - ts[i], Math.min(t, now) - ts[i]) / 3600;
        const k = (Math.abs(w) / 1000) * h;
        if (w > ON) {
          imp += k;
          cost += k * (rateAt(rates, ts[i])?.rate ?? 0);
        } else if (w < -ON) {
          exp += k;
          earn += k * (feedAt(ts[i]) ?? 0);
        }
      }
      return { imp, exp, cost, earn };
    };
    // The rest of today as the forecast has it (its solar, the house's usual use and the battery between them): each
    // hour's grid energy, as power over the part of the hour still to come.
    const hours = (f?.hours ?? []).filter((h) => h.ts + HOUR > now && h.ts < start + DAY);
    const span = (h: ForecastHour) => Math.max(60, h.ts + HOUR - Math.max(h.start, now));
    const estAt = (t: number) => {
      const h = hours.find((x) => x.ts <= t && t < x.ts + HOUR);
      return h ? (h.grid_kwh * 1000 * HOUR) / span(h) : null;
    };
    // What's likely bought and sold between now and `t`, and what it costs and earns, at the prices of the time.
    const likelyBy = (t: number) => {
      let imp = 0;
      let exp = 0;
      let cost = 0;
      let earn = 0;
      for (const h of hours) {
        const a = Math.max(h.start, now);
        const b = Math.min(h.ts + HOUR, t);
        if (b <= a) continue;
        const k = (h.grid_kwh * (b - a)) / span(h);
        const mid = (a + b) / 2;
        if (k > 0) {
          imp += k;
          cost += k * (rateAt(rates, mid)?.rate ?? 0);
        } else {
          exp -= k;
          earn -= k * (feedAt(mid) ?? 0);
        }
      }
      return { imp, exp, cost, earn };
    };
    // Today so far, live: the inverter's counters and the bill's figures when there are; else from the readings.
    const sofar = byT(now);
    const bought = p?.daily_import ?? sofar.imp;
    const sold = p?.daily_export ?? sofar.exp;
    const cost = bill?.import_cost ?? sofar.cost;
    const earned = bill?.feed_in_credit ?? sofar.earn;
    // The day's supply charge: the bill counts all of it from midnight.
    const supply = bill?.supply ?? 0;
    const whole = Math.max(bought, usual.day ?? 0, 0.1) * 1.08;
    const pc = (v: number) => Math.min(100, (v / whole) * 100);

    const at = (view: number, scrubbed: boolean): LiveMoment => {
      const ahead = view > now + 60;
      const when = hhmm(view);
      const w = scrubbed ? (ahead ? estAt(view) : seriesAt(series, "grid_power", view)) : (p?.grid_power ?? null);
      const buying = w != null && w > ON;
      const selling = w != null && w < -ON;
      const rate = rateAt(rates, view);
      const feed = feedAt(view);
      const was = scrubbed ? byT(view) : { imp: bought, exp: sold, cost, earn: earned };
      const will = ahead ? likelyBy(view) : null;
      const by = will
        ? { imp: was.imp + will.imp, exp: was.exp + will.exp, cost: was.cost + will.cost, earn: was.earn + will.earn }
        : was;
      // What today's cost so far, as Today so far has it: bought, less what selling earned, with the supply charge.
      const total = scrubbed ? by.cost - by.earn + supply : (bill?.net_cost ?? by.cost - by.earn);
      const volts = scrubbed ? seriesAt(series, "grid_voltage", view) : (p?.grid_voltage ?? null);
      const cheapTill = rate && rate.rate < CHEAP && (rates?.length ?? 0) > 1 ? nextDear(rates, view) : null;
      const [value, unit] = (w == null ? DASH : kW(Math.abs(w))).split(" ");
      const stats: Stat[] = [
        { label: ahead ? "Likely bought" : "Bought", value: kWh(by.imp), sub: `Cost ${money(by.cost)}` },
        {
          label: ahead ? "Likely sent to the grid" : "Sent to the grid",
          value: kWh(by.exp),
          sub: `Earned ${money(by.earn)}`,
        },
        {
          label: scrubbed ? `Your rate at ${when}` : "Your rate now",
          value: rate ? centsShort(rate.rate) : DASH,
          sub: !rate
            ? "Set your rates"
            : (rates?.length ?? 0) < 2
              ? "Your rate all day"
              : cheapTill
                ? `Cheap until ${hhmm(cheapTill)}`
                : rate.rate >= DEAR
                  ? `Peak, until ${hhmm(rate.to)}`
                  : "A usual price",
        },
        {
          label: "Voltage",
          value: volts == null ? DASH : `${Math.round(volts)} V`,
          sub: volts == null ? "No reading" : volts > 253 ? "Running high" : volts < 216 ? "Running low" : "Normal",
        },
      ];
      return {
        story: story({ scrubbed, ahead, level, reason, w, rate, feed, cheapTill, view }),
        lead: {
          label: `${ahead ? "Likely " : ""}${total >= 0 ? (ahead ? "cost" : "Cost") : ahead ? "credit" : "Credit"} ${scrubbed ? `by ${when}` : "today"}`,
          value: money(Math.abs(total)),
          unit: "",
        },
        slim: {
          label: `${kWh(by.imp)} bought${usual.day != null ? `, a usual day buys ${kWh(usual.day)}` : ""}`,
          fill: pc(by.imp),
          color: COLOR.import,
          ticks: usual.byNow != null ? [{ at: pc(usual.byNow), title: "What a usual day's bought by now" }] : [],
        },
        second: {
          label: `${ahead ? "Likely " : ""}${buying ? (ahead ? "buying" : "Buying") : selling ? (ahead ? "selling" : "Selling") : ahead ? "balanced" : "Balanced"} ${scrubbed ? `at ${when}` : "now"}`,
          value,
          unit,
          sub:
            ahead && w == null
              ? "No forecast for then yet"
              : buying
                ? rate
                  ? `At ${centsShort(rate.rate)} a kWh`
                  : "From the grid"
                : selling
                  ? feed != null
                    ? `Earning ${centsShort(Math.max(0, feed))} a kWh`
                    : "To the grid"
                  : "Solar and battery have it covered",
          live: !scrubbed && (buying || selling),
          color: buying ? COLOR.import : selling ? COLOR.solar : alpha(COLOR.fg, 0.4),
        },
        stats,
      };
    };
    return {
      page: "grid",
      title: "Grid",
      color: COLOR.import,
      at,
      chart: (k) => (
        <GridChart
          series={series}
          rates={rates}
          start={start}
          now={now}
          rise={rise}
          set={set}
          view={k.view}
          live={k.scrubbed ? null : (p?.grid_power ?? null)}
          ahead={hours.map((h) => ({
            t: Math.max(h.start, now),
            to: h.ts + HOUR,
            w: (h.grid_kwh * 1000 * HOUR) / span(h),
          }))}
          estAt={estAt}
          prices={halfHours(grid, start)}
          onScrub={k.onScrub}
          controls={k.controls}
        />
      ),
    };
  }, [s, amber, series, now, p, bill, usual, rates, level, reason, start, rise, set, f, grid]);
}

/** A half hour's wholesale price ($/MWh): the five-minute prices in it where there are, else AEMO's forecast. */
type HalfHour = { from: number; price: number; forecast: boolean };

/** Today half hour by half hour at the wholesale price, or nothing while AEMO isn't followed or has given no prices. */
function halfHours(grid: GridView | undefined, start: number): HalfHour[] {
  if (!grid?.enabled || !grid.prices.length) return [];
  const out: HalfHour[] = [];
  for (let a = start; a < start + DAY; a += HALF) {
    const inside = grid.prices.filter((x) => x.price != null && x.at > a && x.at <= a + HALF);
    const actual = inside.filter((x) => !x.forecast);
    const use = actual.length ? actual : inside;
    if (use.length)
      out.push({ from: a, price: use.reduce((t, x) => t + x.price!, 0) / use.length, forecast: !actual.length });
  }
  return out;
}

/** When the price next reaches the usual or the peak after `t`, or null today. */
function nextDear(rates: RateRun[] | undefined, t: number): number | null {
  return (rates ?? []).find((r) => r.to > t && r.from > t && r.rate >= CHEAP)?.from ?? null;
}

/**
 * What's happening with the grid at the moment shown, in a sentence: trouble first (now only), then selling (and how
 * long power stays cheap), buying and at what price, or barely touching it.
 */
function story(x: {
  scrubbed: boolean;
  ahead: boolean;
  level: GridView["outlook"]["level"];
  reason: string | null;
  w: number | null;
  rate: RateRun | null;
  feed: number | null;
  cheapTill: number | null;
  view: number;
}): string {
  if (!x.scrubbed && x.level === "outage") return LEVEL.outage.sub;
  if (!x.scrubbed && x.level !== "normal") return x.reason ?? LEVEL[x.level].sub;
  if (x.w == null) return x.ahead ? "No forecast for then yet." : "Waiting for the grid's first reading.";
  if (x.ahead) {
    const kw = kW(Math.abs(x.w));
    if (x.w < -ON)
      return `Likely sending about ${kw} to the grid${x.feed != null && x.feed > 0 ? ` at ${centsShort(x.feed)} a kWh` : ""}.`;
    if (x.w > ON) return `Likely buying about ${kw}${x.rate ? ` at ${centsShort(x.rate.rate)} a kWh` : ""}.`;
    return "Likely barely touching the grid, with your solar and battery covering the house.";
  }
  const kw = kW(Math.abs(x.w)).replace(" ", " "); // kept on one line
  if (x.w < -ON) {
    const at = x.feed != null && x.feed > 0 ? ` at ${centsShort(x.feed)} a kWh` : "";
    return `Sending ${kw} to the grid${at}.${x.cheapTill ? ` Power's cheap until about ${hhmm(x.cheapTill)}.` : ""}`;
  }
  if (x.w > ON) return `Buying ${kw}${x.rate ? ` at ${centsShort(x.rate.rate)} a kWh` : ""}.`;
  return x.rate && x.rate.rate >= DEAR
    ? `Barely touching the grid while it's ${centsShort(x.rate.rate)} a kWh. Your battery has the house covered.`
    : "Barely touching the grid. Your panels and battery have the house covered.";
}

const W = 1000;
const H = 220;

/**
 * The grid through the day under the sky, midnight to midnight: buying above the line, selling below it, and the price
 * of each stretch along the bottom (green when cheap, amber at the peak). Drag along it (or use the arrow keys) to move
 * the whole scene to that moment. The areas are drawn once per reading; scrubbing only moves the marker.
 */
function GridChart({
  series,
  rates,
  start,
  now,
  rise,
  set,
  view,
  live,
  ahead,
  estAt,
  prices,
  onScrub,
  controls,
}: {
  /** The rest of today as the forecast has it: grid power (W, + buying) from `t` to `to`. */
  ahead: { t: number; to: number; w: number }[];
  estAt: (t: number) => number | null;
  /** The wholesale price each half hour, drawn under the chart in place of your rates while there are any. */
  prices: HalfHour[];
  series: HistorySeries | undefined;
  rates: RateRun[] | undefined;
  start: number;
  now: number;
  rise: number;
  set: number;
  view: number;
  live: number | null;
  onScrub: (t: number) => void;
  controls: ReactNode;
}) {
  const pc = (t: number) => `${((t - start) / DAY) * 100}%`;
  const { lines, Y } = useMemo(() => {
    const ts = series?.t ?? [];
    const v = series?.grid_power ?? [];
    const top = Math.max(1500, ...v.map((x) => Math.abs(x ?? 0)), ...ahead.map((x) => Math.abs(x.w))) * 1.1;
    const zero = (H - 24) * 0.55;
    const Y = (w: number) => zero - (w / top) * zero * (w > 0 ? 0.92 : 0.7);
    const X = (t: number) => ((t - start) / DAY) * W;
    let imp = "";
    let exp = "";
    let open = false;
    let last = 0;
    let first = 0;
    for (let i = 0; i < ts.length; i++) {
      const w = v[i];
      if (w == null || ts[i] > now) continue;
      if (!open) first = ts[i];
      imp += `${open ? "L" : "M"}${X(ts[i]).toFixed(1)},${Y(Math.max(0, w)).toFixed(1)}`;
      exp += `${open ? "L" : "M"}${X(ts[i]).toFixed(1)},${Y(Math.min(0, w)).toFixed(1)}`;
      open = true;
      last = ts[i];
    }
    const close = (d: string) => (d ? `${d} L${X(last).toFixed(1)},${zero} L${X(first).toFixed(1)},${zero} Z` : "");
    const dear = (r: number) => (r < CHEAP / 1.8 ? COLOR.good : r >= DEAR ? COLOR.warn : alpha(COLOR.fg, 0.22));
    // The rest of today, likely: the forecast's hours eased into one another every five minutes, buying and selling
    // each as its own faint areas with a dashed edge, only where there's something to draw.
    const mids = ahead.map((x) => ({ t: (x.t + x.to) / 2, w: x.w }));
    const eased = (t: number) => {
      if (!mids.length) return 0;
      if (t <= mids[0].t) return mids[0].w;
      const i = mids.findIndex((m) => m.t > t);
      if (i < 0) return mids[mids.length - 1].w;
      const a = mids[i - 1];
      const b = mids[i];
      return a.w + ((b.w - a.w) * (t - a.t)) / (b.t - a.t);
    };
    const runs = (sign: 1 | -1) => {
      const fill: string[] = [];
      const edge: string[] = [];
      let run: [number, number][] = [];
      const end = () => {
        if (run.length > 1) {
          const d = `M${run.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L")}`;
          edge.push(d);
          fill.push(`${d} L${run[run.length - 1][0].toFixed(1)},${zero} L${run[0][0].toFixed(1)},${zero} Z`);
        }
        run = [];
      };
      for (let t = ahead[0]?.t ?? start + DAY; t <= start + DAY; t += 300) {
        const w = eased(t);
        if (w * sign > ON) run.push([X(t), Y(w)]);
        else end();
      }
      end();
      return { fill: fill.join(" "), edge: edge.join(" ") };
    };
    const likelyIn = runs(1);
    const likelyOut = runs(-1);
    const lines = (
      <svg
        aria-hidden
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="absolute inset-x-0 bottom-[26px] h-[108px] w-full overflow-visible max-sm:h-[86px]"
      >
        <line
          x1={0}
          x2={W}
          y1={zero}
          y2={zero}
          vectorEffect="non-scaling-stroke"
          style={{ stroke: alpha(COLOR.fg, 0.3) }}
        />
        {imp && <path d={close(imp)} style={{ fill: alpha(COLOR.import, 0.45) }} />}
        {exp && <path d={close(exp)} style={{ fill: alpha(COLOR.solar, 0.4) }} />}
        {likelyIn.fill && (
          <>
            <path d={likelyIn.fill} style={{ fill: alpha(COLOR.import, 0.14) }} />
            <path
              d={likelyIn.edge}
              fill="none"
              strokeWidth={1.5}
              strokeDasharray="4 5"
              vectorEffect="non-scaling-stroke"
              style={{ stroke: alpha(COLOR.import, 0.8) }}
            />
          </>
        )}
        {likelyOut.fill && (
          <>
            <path d={likelyOut.fill} style={{ fill: alpha(COLOR.solar, 0.12) }} />
            <path
              d={likelyOut.edge}
              fill="none"
              strokeWidth={1.5}
              strokeDasharray="4 5"
              vectorEffect="non-scaling-stroke"
              style={{ stroke: alpha(COLOR.solar, 0.75) }}
            />
          </>
        )}
        {prices.length > 0
          ? prices.map((x) => {
              const k = wholesaleKind(x.price);
              return (
                <rect
                  key={x.from}
                  x={X(x.from) + 1}
                  width={Math.max(1, X(x.from + HALF) - X(x.from) - 2)}
                  y={H - 12}
                  height={10}
                  rx={3}
                  style={{
                    fill: k === "cheap" ? COLOR.teal : k === "dear" ? COLOR.export : alpha(COLOR.fg, 0.22),
                    opacity: x.forecast ? 0.45 : 0.85,
                  }}
                />
              );
            })
          : (rates ?? []).map((r, i) => {
              const a = Math.max(start, r.from);
              const b = Math.min(start + DAY, r.to);
              if (b <= a) return null;
              return (
                <rect
                  key={i}
                  x={X(a) + 1}
                  width={Math.max(1, X(b) - X(a) - 2)}
                  y={H - 12}
                  height={10}
                  rx={3}
                  style={{ fill: dear(r.rate), opacity: 0.8 }}
                />
              );
            })}
      </svg>
    );
    return { lines, Y };
  }, [series, rates, start, now, ahead, prices]);
  const w = live ?? (view > now + 60 ? estAt(view) : seriesAt(series, "grid_power", view));
  const dot = w != null && w < -ON ? COLOR.solar : COLOR.import;

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
          style={{ top: `${(Y(0) / H) * 100}%` }}
        >
          Buying above, selling below
        </span>
        <span className="absolute right-0 bottom-[14px] text-[10.5px] text-ink-faint max-sm:hidden">
          {prices.length ? "Wholesale price each half hour" : "Your rates"}
        </span>
        <span className="absolute inset-y-0 w-px bg-ink/55" style={{ left: pc(view) }} />
        {w != null && (
          <span
            className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface transition-colors duration-300"
            style={{
              left: pc(view),
              top: `${(Y(w) / H) * 100}%`,
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
