import { useQuery } from "@tanstack/react-query";
import { useHasBattery } from "~/features/battery/hooks";
import { ON, reserveOf } from "~/features/common/energy/utils";
import { duration, hhmm } from "~/features/common/formatting/utils/date";
import { centsShort, DASH, kW, kWh, money, pct, signedPct } from "~/features/common/formatting/utils/number";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import { costsQuery } from "~/features/common/readings/api";
import type { HistorySeries } from "~/features/common/readings/types";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, dateKey, midnight } from "~/features/common/time/utils";
import { ButtonLink } from "~/features/common/ui/components/Button";
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
import { RateRow, RateStrip, rateAt } from "~/features/home/components/RateStrip";
import { useRates } from "~/features/home/hooks";
import { useUsualImport } from "~/features/grid/hooks";
import type { GridView, OutlookReason, WholesalePrice } from "~/features/grid/types";
import { EXPORT, IMPORT, LEVEL, perMWh, wholesaleCents } from "~/features/grid/utils";

const WHOLESALE = COLOR.lilac;
const FAINT = alpha(COLOR.fg, 0.4);

/** The outlook's level in a word. */
export const STATUS: Record<GridView["outlook"]["level"], string> = {
  normal: "Normal",
  watch: "Worth knowing",
  warning: "Blackout risk",
  outage: "Down",
};

/** "2.10 kW" as a figure and its unit. */
const split = (text: string) => {
  const [value, unit] = text.split(" ");
  return { value, unit };
};

/**
 * The grid today and now, in one card, as Solar's, Home's and Battery's: what the house has bought today and what it
 * cost (against a usual day by now), what it's buying or selling now, what it sold, what power costs now, the
 * wholesale price and how the grid's holding up; today's buying along a bar against a usual day's; when the grid isn't
 * normal, what to do and why (how long the battery would last, a way to top it up while there's grid); and, unless
 * `chart` is off, power to and from the grid through the day with the rates and the wholesale price under it.
 */
export function GridHero({
  grid,
  p,
  s,
  series,
  start,
  now,
  chart = true,
}: {
  grid: GridView | undefined;
  p: Snapshot | null;
  s: SystemInfo | undefined;
  series: HistorySeries | undefined;
  start: number;
  now: number;
  chart?: boolean;
}) {
  const level = grid?.outlook.level;
  const tint = level && level !== "normal" ? LEVEL[level].color : IMPORT;
  const g = p?.grid_power;
  const buying = g != null && g > ON;
  const selling = g != null && g < -ON;
  const market = grid?.market;
  const { data: costs } = useQuery(costsQuery(midnight(now)));
  const bill = costs?.days.find((d) => d.date === dateKey(now));
  const rates = useRates(start);
  const rate = rateAt(rates, now);
  const usual = useUsualImport(now);
  const bought = p?.daily_import ?? null;
  const fit = s?.tariff && s.tariff.type !== "amber" && s.tariff.feed_in_rate !== "" ? s.tariff.feed_in_rate : null;
  const charging = (p?.battery_power ?? 0) < -ON;
  const discharging = (p?.battery_power ?? 0) > ON;
  const pts: LinePoint[] = series ? series.t.map((t, i) => ({ t, v: series.grid_power?.[i] ?? null })) : [];
  const prices = grid?.enabled ? grid.prices : [];
  return (
    <HeroCard label="Grid today and now" tint={tint}>
      <HeroTop>
        <HeroFigures>
          <HeroLead
            label="Bought today"
            {...(bought == null ? { value: DASH } : split(kWh(bought)))}
            sub={
              <>
                {bill
                  ? `${money(bill.import_cost)} at your rates`
                  : bought == null
                    ? "No reading yet"
                    : "From the grid"}
                <VsUsual bought={bought} usual={usual.byNow} />
              </>
            }
          />
          <HeroLive
            label={buying ? "Buying now" : selling ? "Selling now" : "Grid idle"}
            on={buying || selling}
            color={buying ? IMPORT : selling ? EXPORT : alpha(COLOR.fg, 0.4)}
            {...(g == null ? { value: DASH } : split(kW(Math.abs(g))))}
            sub={
              g == null ? undefined : buying ? (
                <>
                  {charging ? "To your home and battery" : "To your home"}
                  {rate && <Delta value={0}>About {money((g / 1000) * rate.rate)} an hour</Delta>}
                </>
              ) : selling ? (
                <>
                  {discharging ? "From solar and the battery" : "From solar"}
                  {fit != null && fit > 0 && <Delta value={0}>About {money((-g / 1000) * fit)} an hour</Delta>}
                </>
              ) : (
                "Nothing in or out"
              )
            }
          />
        </HeroFigures>
        <HeroStats>
          <HeroStat
            label="Sold today"
            value={kWh(p?.daily_export)}
            sub={bill ? `${money(bill.feed_in_credit)} earned` : undefined}
          />
          <HeroStat
            label="Power costs now"
            value={rate ? `${centsShort(rate.rate)}/kWh` : DASH}
            sub={rate ? (rates!.length > 1 ? `${rate.name} until ${hhmm(rate.to)}` : rate.name) : undefined}
          />
          <HeroStat
            label="Wholesale now"
            value={market ? `${wholesaleCents(market.price)}/kWh` : DASH}
            sub={
              market
                ? `${perMWh(market.price)}`
                : grid && !grid.enabled
                  ? grid.region_auto && !grid.location_set
                    ? "Needs your location"
                    : "Not following AEMO"
                  : "Waiting for AEMO"
            }
          />
          <HeroStat
            label="The grid"
            value={
              <span style={level && level !== "normal" ? { color: LEVEL[level].color } : undefined}>
                {level ? STATUS[level] : DASH}
              </span>
            }
            sub={
              !grid
                ? "Checking"
                : level === "normal"
                  ? grid.enabled
                    ? "No warnings near you"
                    : "Steady at your house"
                  : `${grid.outlook.reasons.length || 1} ${grid.outlook.reasons.length > 1 ? "things" : "thing"} to know`
            }
          />
        </HeroStats>
      </HeroTop>
      <Pace bought={bought} usual={usual} />
      {grid && level !== "normal" && <Warnings grid={grid} p={p} s={s} />}
      {chart &&
        (series ? (
          <TimeLine
            label="Power from and to the grid through the day"
            points={pts}
            start={start}
            end={addDays(start, 1)}
            now={now}
            color={IMPORT}
            height={200}
            every={3}
            signed={{ above: IMPORT, below: EXPORT }}
            empty="No readings today yet."
            tip={(pt) => {
              const v = pt.v ?? 0;
              const w = priceAt(prices, pt.t);
              return (
                <>
                  <span className="font-medium text-ink">{hhmm(pt.t)}</span>
                  {pt.v != null && (
                    <TooltipRow
                      label={v > ON ? "Buying" : v < -ON ? "Selling" : "Grid"}
                      value={Math.abs(v) > ON ? kW(Math.abs(v)) : "Idle"}
                      color={v > ON ? IMPORT : v < -ON ? EXPORT : undefined}
                    />
                  )}
                  <RateRow runs={rates} t={pt.t} />
                  {w?.price != null && (
                    <TooltipRow
                      label={w.forecast ? "Wholesale, forecast" : "Wholesale"}
                      value={`${wholesaleCents(w.price)}/kWh`}
                      color={WHOLESALE}
                    />
                  )}
                </>
              );
            }}
            under={
              rates?.length || prices.length
                ? (a, b) => (
                    <div className="flex flex-col gap-2">
                      {rates?.length ? <RateStrip runs={rates} start={a} end={b} now={now} /> : null}
                      {prices.length > 0 && <WholesaleStrip prices={prices} start={a} end={b} now={now} />}
                    </div>
                  )
                : undefined
            }
          />
        ) : (
          <Skeleton className="h-[260px] rounded-2xl" />
        ))}
    </HeroCard>
  );
}

/** Today's buying against a usual day's by now: a percentage once that's worth one, else the difference in kWh. */
function VsUsual({ bought, usual }: { bought: number | null; usual: number | null }) {
  if (bought == null || usual == null) return null;
  const diff = bought - usual;
  if (usual >= 1)
    return (
      <Delta value={diff / usual} invert>
        {signedPct((diff / usual) * 100)} on a usual day
      </Delta>
    );
  if (Math.abs(diff) < 0.1)
    return (
      <Delta value={0} invert>
        As usual
      </Delta>
    );
  return (
    <Delta value={diff} invert>
      {diff > 0 ? "+" : "−"}
      {kWh(Math.abs(diff))} on a usual day
    </Delta>
  );
}

/**
 * Today's buying along one bar: bought so far, what a usual rest of the day would add (dashed), a tick for what a
 * usual day has bought by now and a fainter one for a whole usual day. Left out when there's next to nothing to show.
 */
function Pace({ bought, usual }: { bought: number | null; usual: { byNow: number | null; day: number | null } }) {
  const b = bought ?? 0;
  const heading = usual.day != null && usual.byNow != null ? b + Math.max(0, usual.day - usual.byNow) : null;
  const whole = Math.max(heading ?? 0, usual.day ?? 0, b, 0.1);
  if (Math.max(b, usual.day ?? 0) < 0.2) return null;
  const at = (v: number) => Math.min(100, (v / whole) * 100);
  return (
    <HeroBar
      legend={
        <>
          <HeroKey mark="dot" color={IMPORT}>
            Bought so far
          </HeroKey>
          {usual.byNow != null && <HeroKey mark="tick">{kWh(usual.byNow)} usual by now</HeroKey>}
          {usual.day != null && (
            <HeroKey mark="tick" color={FAINT}>
              {kWh(usual.day)} on a usual day
            </HeroKey>
          )}
          {heading != null && heading > b + 0.05 && (
            <HeroKey mark="dashed" color={IMPORT}>
              {kWh(heading)} by midnight
            </HeroKey>
          )}
        </>
      }
    >
      {heading != null && <HeroFill to={at(heading)} color={IMPORT} variant="dashed" />}
      <HeroFill to={at(b)} color={IMPORT} />
      {usual.byNow != null && <HeroTick at={at(usual.byNow)} title="A usual day by now" />}
      {usual.day != null && <HeroTick at={at(usual.day)} color={FAINT} title="A usual whole day" />}
    </HeroBar>
  );
}

/**
 * In the card when the grid's not normal, washed in its colour: what it means, the battery (how long it would last at
 * this use, and a way to charge it from the grid while there's still grid, when it's worth it), and each reason.
 */
function Warnings({ grid, p, s }: { grid: GridView; p: Snapshot | null; s: SystemInfo | undefined }) {
  const { level, reasons } = grid.outlook;
  const l = LEVEL[level];
  const hasBattery = useHasBattery();
  const soc = p?.battery_soc;
  const cap = s?.battery_kwh;
  const load = p?.load_power;
  // What's left above the reserve, at what the house is using now.
  const left =
    soc != null && cap && load && load > ON ? ((Math.max(0, soc - reserveOf(s)) / 100) * cap * 1000) / load : null;
  const worried = level === "warning" || reasons.some((r) => r.kind === "storm");
  return (
    <div
      className="flex flex-col gap-3.5 rounded-2xl border px-4 py-3.5"
      style={{ background: alpha(l.color, 0.08), borderColor: alpha(l.color, 0.25) }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <div className="text-[13.5px] leading-5 font-medium text-pretty text-ink">{l.sub}</div>
        {hasBattery && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-col items-end text-right text-[13px] leading-5 tabular-nums max-sm:items-start max-sm:text-left">
              <span className="font-medium text-ink">Battery {pct(soc)}</span>
              {left != null && <span className="text-ink-faint">About {duration(left * 3600)} at this use</span>}
            </div>
            {worried && soc != null && soc < 95 && (
              <ButtonLink to="/battery" variant="primary" size="sm">
                Charge from the grid
              </ButtonLink>
            )}
          </div>
        )}
      </div>
      {reasons.length > 0 && (
        <ul className="flex flex-col gap-2">
          {reasons.map((r, i) => (
            <Reason key={`${r.kind}${i}`} r={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Reason({ r }: { r: OutlookReason }) {
  return (
    <li className="flex items-baseline gap-2.5 text-[13.5px] leading-5">
      <span
        aria-hidden
        className="size-2 flex-none translate-y-[-1px] rounded-full"
        style={{ background: LEVEL[r.level].color }}
      />
      <span className="min-w-0">
        <span className="font-medium text-ink">{r.title}</span>
        <span className="text-ink-muted"> · {r.detail}</span>
      </span>
    </li>
  );
}

/** How long a wholesale price runs up to its `at`: five minutes, or half an hour for AEMO's forecast. */
const span = (x: WholesalePrice) => (x.forecast ? 1800 : 300);

/** The wholesale price in force at `t`. */
const priceAt = (prices: WholesalePrice[], t: number) => prices.find((x) => x.at - span(x) <= t && t < x.at) ?? null;

const SH = 30;

/**
 * The wholesale price under the day's chart, on its time scale: a slim line (AEMO's forecast dashed) washed in below,
 * with the day's top price named, so you can see when the market was dear against what you bought and sold.
 */
function WholesaleStrip({
  prices,
  start,
  end,
  now,
}: {
  prices: WholesalePrice[];
  start: number;
  end: number;
  now: number;
}) {
  const shown = prices.filter((x) => x.price != null && x.at > start && x.at - span(x) < end);
  if (shown.length < 2) return null;
  const vs = shown.map((x) => x.price!);
  const lo = Math.min(0, ...vs);
  const hi = Math.max(...vs, 1);
  const X = (t: number) => ((Math.max(start, Math.min(end, t)) - start) / (end - start)) * 1000;
  const Y = (v: number) => SH - 2 - ((v - lo) / (hi - lo)) * (SH - 12);
  const line = (list: WholesalePrice[]) =>
    list.map((x, i) => `${i ? "L" : "M"}${X(x.at - span(x) / 2).toFixed(1)} ${Y(x.price!).toFixed(1)}`).join(" ");
  const past = shown.filter((x) => !x.forecast);
  const ahead = shown.filter((x) => x.forecast);
  // The forecast picks up from the last actual price, so the two lines meet.
  const joined = past.length && ahead.length ? [past[past.length - 1], ...ahead] : ahead;
  const top = past.length ? past.reduce((a, b) => (b.price! > a.price! ? b : a)) : null;
  const base = Y(Math.max(lo, 0));
  const area =
    past.length > 1
      ? `${line(past)} L${X(past[past.length - 1].at).toFixed(1)} ${base} L${X(past[0].at - span(past[0])).toFixed(1)} ${base} Z`
      : "";
  const nowX = now >= start && now <= end ? X(now) : null;
  return (
    <div className="relative" style={{ height: SH }} role="img" aria-label="Wholesale price through the day">
      <svg
        viewBox={`0 0 1000 ${SH}`}
        preserveAspectRatio="none"
        className="absolute inset-0 size-full overflow-visible"
      >
        {area && <path d={area} fill={alpha(WHOLESALE, 0.16)} />}
        <line x1={0} x2={1000} y1={base} y2={base} className="stroke-line-subtle" vectorEffect="non-scaling-stroke" />
        {past.length > 1 && (
          <path d={line(past)} fill="none" stroke={WHOLESALE} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        )}
        {joined.length > 1 && (
          <path
            d={line(joined)}
            fill="none"
            stroke={alpha(WHOLESALE, 0.7)}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {nowX != null && (
          <line
            x1={nowX}
            x2={nowX}
            y1={0}
            y2={SH}
            stroke={alpha(COLOR.fg, 0.25)}
            vectorEffect="non-scaling-stroke"
            strokeDasharray="2 2"
          />
        )}
      </svg>
      <span className="absolute top-0 left-1 text-[10.5px] leading-tight text-ink-faint tabular-nums">
        Wholesale{top ? ` · up to ${wholesaleCents(top.price)} at ${hhmm(top.at)}` : ""}
      </span>
    </div>
  );
}
