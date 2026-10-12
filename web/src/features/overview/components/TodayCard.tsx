import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { costsQuery } from "~/features/common/readings/api";
import type { CostDay } from "~/features/common/readings/types";
import type { Tariff } from "~/features/common/tariffs/types";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Card, CardHeader } from "~/features/common/ui/components/Card";
import { cn } from "~/features/common/ui/utils";
import { centsShort, kWh, money } from "~/features/common/formatting/utils/number";
import { minutesLabel } from "~/features/common/formatting/utils/date";
import { priceLabel } from "~/features/amber/utils";
import { bandColor, bandTable, tariffNumber, usedBands } from "~/features/common/tariffs/utils";
import { dateKey, isWeekend, midnight, partsOf } from "~/features/common/time/utils";
import { COLOR } from "~/features/common/theme/utils/colors";
import { roomOf, rowsFor } from "~/features/common/widgets/room";
import type { Settings } from "~/features/common/widgets/types";

/** Heights (px) of the parts, for what fits: the header and the gap under it, the gap between parts, the split bar
 * with its legend, a figure's sentence, a row of the full table and of the short list, the table's head and total,
 * and the strip of rates. */
const HEAD = 34 + 12;
const GAP = 12;
const SPLIT = 8 + 10 + 16;
const SUB = 4 + 18;
const ROW = 56;
const LIST_ROW = 28;
const TABLE_ENDS = 24 + 34;
const STRIP = 68;

/** Which figure comes first (and, at the smallest, the one shown big). */
export const TODAY_LEADS = [
  { value: "cost", label: "Cost" },
  { value: "saved", label: "Saved" },
];

/** What the card shows, given room for it. */
export type TodayShow = {
  lead: "cost" | "saved";
  /** Each figure's sentence (the supply charge, what it would have cost without solar). */
  subs: boolean;
  /** The bar of what you pay against what solar and the battery cover. */
  split: boolean;
  /** Today rate by rate. */
  rates: boolean;
  /** The kind of rates, linking to them, in the header. */
  tariff: boolean;
};

/** A widget's settings as what it shows: everything on, unless switched off, led by the cost. */
export function todayShow(settings: Settings): TodayShow {
  return {
    lead: settings.lead === "saved" ? "saved" : "cost",
    subs: settings.subs !== false,
    split: settings.split !== false,
    rates: settings.rates !== false,
    tariff: settings.tariff !== false,
  };
}
const ALL = todayShow({});

/**
 * The most rows the card can use at `w` columns for what it shows: with today rate by rate, any (the rates take
 * what's left); without, the header, the figures and the split.
 */
export function todayRows(show: TodayShow, w: number) {
  if (show.rates) return undefined;
  return w <= 2
    ? rowsFor(HEAD + 2 * 58 + 8 + (show.split ? GAP + 8 : 0))
    : rowsFor(HEAD + 20 + 2 + 48 + (show.subs ? SUB : 0) + (show.split ? GAP + SPLIT : 0));
}

/** One rate's line: what came from the grid at it, what that cost, and what solar and the battery saved. */
type Line = {
  key: string;
  dot: string;
  label: string;
  sub: string;
  kwh?: string;
  cost: string;
  saved: string;
  savedOn: boolean;
  /** The energy behind the saving (home use covered by solar or the battery, or kWh exported). */
  savedKwh?: string;
};

/**
 * Today so far: cost and savings, split by rate, fitted to its size on the grid (`w` columns by `h` rows) rather than
 * stretched to it. At its smallest (2 × 2) it's the leading figure big, the other under it and the split; wider, both
 * side by side; taller, a header with the kind of rates, each figure's sentence and the split's legend. Given room,
 * today rate by rate: as tiles in a short wide one, as a short list where the full table won't fit, and the full
 * table where it will (beside the figures at the whole width). `show` leaves any of it out.
 */
export function TodayCard({
  tariff,
  now,
  w = 6,
  h = 7,
  show = ALL,
}: {
  tariff: Tariff | undefined;
  now: number;
  /** Its size on the grid, in columns and rows. */
  w?: number;
  h?: number;
  show?: TodayShow;
}) {
  const id = useId();
  // Today's costs come from the server, priced at the rate in force for each 5 minutes.
  const { data } = useQuery(costsQuery(midnight(now)));
  const c = data?.days.find((d) => d.date === dateKey(now));
  const t = c && tariff;
  const { wide, tall, inner } = roomOf(w, h);
  const xs = wide === "xs";
  const lg = wide === "lg";
  const header = tall !== "short";
  // A figure's height: its label and value, by how tall the card is.
  const big = tall === "tall" ? 60 : tall === "mid" ? 48 : 40;
  const subs = show.subs && header && !xs;
  const split = show.split && (!xs || h !== 3);
  const figures = (xs && header ? 2 * (20 + 2 + 36) + 8 : 20 + 2 + big) + (subs ? SUB : 0);
  const lines = c && t && show.rates ? linesOf(c, t, now) : null;
  const note = lines?.note ?? null;
  // Today rate by rate, beside the figures (wide) or under them, in what space is left.
  const beside = lg;
  const left = inner - (header ? HEAD : 0) - (beside ? 0 : figures + (split ? GAP + SPLIT : 0) + GAP) - (note ? 44 : 0);
  const rates =
    !lines || xs
      ? null
      : TABLE_ENDS + lines.rows.length * ROW <= left && (beside || tall === "tall")
        ? "table"
        : (lines.rows.length + 1) * LIST_ROW <= left && (beside || tall !== "short")
          ? "list"
          : STRIP <= left && beside
            ? "strip"
            : null;
  const [first, second] = show.lead === "saved" ? (["saved", "cost"] as const) : (["cost", "saved"] as const);
  return (
    <Card aria-labelledby={id} className="@container h-full gap-3 overflow-hidden p-5 max-sm:p-4">
      {header ? (
        tall === "tall" && w >= 5 ? (
          <CardHeader title="Today so far" id={id} className="h-[34px]" action={show.tariff && <RateType t={t} />} />
        ) : (
          <div className="flex h-[34px] min-w-0 items-center gap-3">
            <span id={id} className="min-w-0 flex-1 truncate font-display text-base font-bold">
              Today so far
            </span>
            {show.tariff && w >= 4 && <RateType t={t} />}
          </div>
        )
      ) : (
        <span id={id} className="sr-only">
          Today so far
        </span>
      )}
      <div className={cn("flex min-h-0 min-w-0 flex-1 gap-6", beside ? "flex-row" : "flex-col")}>
        <div
          // anchored to the top, with the rates beside them starting level
          className={cn(
            "flex min-w-0 flex-col gap-3",
            beside && (rates ? "w-[26rem] max-w-[45%] flex-none" : "flex-1"),
          )}
        >
          {xs ? (
            <div className="flex flex-col gap-2">
              <Figure c={c} which={first} size="s" />
              {header ? <Figure c={c} which={second} size="s" /> : <Aside c={c} which={second} />}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <Figure c={c} which={first} size={tall === "tall" ? "l" : tall === "mid" ? "m" : "s"} sub={subs} />
              <Figure c={c} which={second} size={tall === "tall" ? "l" : tall === "mid" ? "m" : "s"} sub={subs} />
            </div>
          )}
          {split && <Split c={c} legend={header && !xs} />}
        </div>
        {lines && rates && (
          // the rates take what's left, and never push the card taller than its rows
          <div className="relative min-h-0 min-w-0 flex-1">
            <div className="absolute inset-0 flex flex-col overflow-hidden">
              {rates === "table" ? (
                <Table rows={lines.rows} c={c!} note={note} />
              ) : rates === "list" ? (
                <List rows={lines.rows} c={c!} />
              ) : (
                <Strip rows={lines.rows} />
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function RateType({ t }: { t: Tariff | undefined | null | false }) {
  return (
    <ButtonLink to="/bills/rates" hash="rates" variant="chip" className="flex-none">
      {t ? RATE_TYPE[t.type] : "Rates"}
    </ButtonLink>
  );
}

/** What today would have cost without solar and the battery. */
const without = (c: CostDay) => c.net_cost + c.saved;

/** Today's cost (or credit, when feed-in covers it) or its saving, big, with what it is and a sentence on it. */
function Figure({
  c,
  which,
  size,
  sub,
}: {
  c: CostDay | undefined;
  which: "cost" | "saved";
  size: "s" | "m" | "l";
  sub?: boolean;
}) {
  // In credit when feed-in is worth more than today's usage and supply charge.
  const credit = !!c && c.net_cost < 0;
  const [k, v, line, good] =
    which === "cost"
      ? [
          credit ? "Credit today" : "Cost today",
          c ? money(Math.abs(c.net_cost)) : "—",
          credit ? "Nice, feed-in covers today's costs so far" : "Including the daily supply charge",
          credit,
        ]
      : [
          "Saved today",
          c ? money(Math.max(0, c.saved)) : "—",
          c ? `Without solar you'd pay ${money(without(c))}` : " ",
          true,
        ];
  return (
    <div className="@container flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-sm leading-5 text-ink-dim">{k}</span>
      <span
        className={cn(
          "font-light whitespace-nowrap tabular-nums",
          size === "l"
            ? "text-[40px] leading-11 tracking-[-1.5px] @min-[13rem]:text-[56px] @min-[13rem]:leading-[60px] @min-[13rem]:tracking-[-2.5px]"
            : size === "m"
              ? "text-[32px] leading-9 tracking-[-1px] @min-[11rem]:text-[44px] @min-[11rem]:leading-12 @min-[11rem]:tracking-[-2px]"
              : "text-[28px] leading-9 tracking-[-1px] @min-[11rem]:text-[34px] @min-[11rem]:leading-10",
          good ? "text-good" : "text-ink",
        )}
      >
        {v}
      </span>
      {sub && (
        <span className="mt-1 truncate text-[13px] leading-[18px] text-ink-label tabular-nums @max-[12rem]:hidden">
          {line}
        </span>
      )}
    </div>
  );
}

/** The other figure, small, under the one shown big. */
function Aside({ c, which }: { c: CostDay | undefined; which: "cost" | "saved" }) {
  const credit = !!c && c.net_cost < 0;
  return (
    <span
      className={cn(
        "truncate text-[13px] leading-[18px] tabular-nums",
        which === "saved" || credit ? "text-good" : "text-ink-label",
      )}
    >
      {which === "saved"
        ? `Saved ${c ? money(Math.max(0, c.saved)) : "—"}`
        : `${credit ? "Credit" : "Cost"} ${c ? money(Math.abs(c.net_cost)) : "—"}`}
    </span>
  );
}

/** What you pay against what solar and the battery cover, as a bar, with a legend where there's room. */
function Split({ c, legend }: { c: CostDay | undefined; legend: boolean }) {
  const wo = c ? without(c) : 0;
  const credit = !!c && c.net_cost < 0;
  const paid = !c || credit ? "0" : `${wo > 0 ? Math.max(2, Math.min(100, (c.net_cost / wo) * 100)).toFixed(1) : 2}%`;
  return (
    <div className="@container flex flex-col gap-2.5">
      <div className="flex h-2 overflow-hidden rounded-full bg-track">
        <div
          className="origin-left animate-fill-x bg-ink transition-[width] duration-320 ease-out-soft"
          style={{ width: paid }}
        />
        <div className="flex-1 bg-good" />
      </div>
      {legend && (
        <div className="flex h-4 justify-between gap-3 text-xs leading-4 whitespace-nowrap text-ink-label tabular-nums">
          <span className="flex min-w-0 items-center gap-1.5">
            <i className="size-2 flex-none rounded-full bg-ink" />
            <span className="truncate">
              {c && (credit ? `In credit ${money(-c.net_cost)}` : `You pay ${money(c.net_cost)}`)}
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">
              {c && (
                <>
                  <span className="@max-[22rem]:hidden">Solar and battery cover </span>
                  <span className="@min-[22rem]:hidden">Covered </span>
                  {money(Math.max(0, c.saved))}
                </>
              )}
            </span>
            <i className="size-2 flex-none rounded-full bg-good" />
          </span>
        </div>
      )}
    </div>
  );
}

const RATE_TYPE: Record<Tariff["type"], string> = { flat: "Single rate", tou: "Time of use", amber: "Amber" };

/**
 * Today rate by rate. On rates of its own: each rate used (a time-of-use one yet to start, with when), the supply
 * charge and the solar credit. On Amber: grid power at the prices of the time (with its average), anything costed at
 * the fallback rate because Amber had no price (with a note on it), the supply charge, and feed-in at the prices of
 * the time (which can cost money when the feed-in price is negative).
 */
function linesOf(c: CostDay, t: Tariff, now: number): { rows: Line[]; note: string | null } {
  const supply: Line = {
    key: "supply",
    dot: COLOR.barFaint,
    label: "Supply charge",
    sub: "Fixed daily charge",
    cost: money(c.supply),
    saved: "–",
    savedOn: false,
  };
  if (t.type === "amber") {
    const [priced, fallback] = c.bands;
    const fit = c.feed_in_rate;
    const unpriced = c.unpriced_kwh ?? 0;
    const rows: Line[] = [];
    if (priced)
      rows.push({
        key: "amber",
        dot: COLOR.ink,
        label: "Amber prices",
        sub: `${priced.import_kwh > 0 ? "Average" : "Today's average"} ${priceLabel(priced.rate)} per kWh`,
        kwh: kWh(priced.import_kwh),
        cost: money(priced.cost),
        saved: money(Math.max(0, priced.saved)),
        savedOn: true,
        savedKwh: kWh(priced.self_kwh),
      });
    if (fallback && (fallback.import_kwh > 0 || fallback.home_kwh > 0))
      rows.push({
        key: "fallback",
        dot: COLOR.gridLine,
        label: "No Amber price",
        sub: `Fallback rate ${centsShort(fallback.rate)} per kWh`,
        kwh: kWh(fallback.import_kwh),
        cost: money(fallback.cost),
        saved: money(Math.max(0, fallback.saved)),
        savedOn: true,
        savedKwh: kWh(fallback.self_kwh),
      });
    rows.push(supply, {
      key: "solar",
      dot: COLOR.solar,
      label: c.feed_in_credit < 0 ? "Solar export cost" : "Solar credit",
      sub: fit != null ? `Exported at an average ${priceLabel(fit)} per kWh` : "Nothing exported yet",
      cost: money(-c.feed_in_credit),
      saved: money(c.feed_in_credit),
      savedOn: c.feed_in_credit >= 0,
      savedKwh: kWh(c.export_kwh),
    });
    return {
      rows,
      note:
        unpriced >= 0.05
          ? `${kWh(unpriced)} was priced at your fallback rate because Amber had no price for those times yet.`
          : null,
    };
  }
  const tou = t.type === "tou";
  const used = usedBands(t);
  const d = partsOf(now);
  const nowMin = d.hour * 60 + d.minute;
  const today = bandTable(t, isWeekend(now) ? "weekend" : "weekday").tab;
  const startsAt = (i: number) => {
    const m = today.findIndex((x, k) => k >= nowMin && x === i);
    return m < 0 ? null : minutesLabel(m);
  };
  const rows: Line[] = c.bands
    .map((b, i) => ({ ...b, i }))
    .filter((b) => used.has(b.i) || b.import_kwh > 0 || b.home_kwh > 0)
    .sort((x, y) => x.rate - y.rate)
    .map((b) => {
      const notYet = tou && b.home_kwh < 0.005 && !today.slice(0, nowMin).includes(b.i);
      const at = notYet && startsAt(b.i);
      return at
        ? {
            key: `band-${b.i}`,
            dot: bandColor(b.i),
            label: b.name,
            sub: `Starts ${at} · ${centsShort(b.rate)} per kWh`,
            cost: "–",
            saved: "–",
            savedOn: false,
          }
        : {
            key: `band-${b.i}`,
            dot: tou ? bandColor(b.i) : COLOR.gridLine,
            label: tou ? b.name : "Single rate",
            sub: `${centsShort(b.rate)} per kWh`,
            kwh: kWh(b.import_kwh),
            cost: money(b.cost),
            saved: money(Math.max(0, b.saved)),
            savedOn: true,
            savedKwh: kWh(b.self_kwh),
          };
    });
  rows.push(supply, {
    key: "solar",
    dot: COLOR.solar,
    label: "Solar credit",
    sub: `Exported at ${centsShort(tariffNumber(t.feed_in_rate))} per kWh`,
    cost: money(-c.feed_in_credit),
    saved: money(c.feed_in_credit),
    savedOn: true,
    savedKwh: kWh(c.export_kwh),
  });
  return { rows, note: null };
}

const COLS =
  "grid grid-cols-[minmax(0,1.6fr)_minmax(64px,0.8fr)_minmax(64px,0.8fr)_minmax(64px,0.8fr)] items-center gap-3 tabular-nums max-xs:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(52px,0.8fr))] max-xs:gap-2";

/** Today rate by rate in full: what came from the grid, the cost and the saving, with the day's total. */
function Table({ rows, c, note }: { rows: Line[]; c: CostDay; note: string | null }) {
  return (
    <div className="flex flex-col">
      <div className={cn(COLS, "pb-2 text-xs text-ink-muted")}>
        <span>Period</span>
        <span className="text-right">From grid</span>
        <span className="text-right">Cost</span>
        <span className="text-right">Saved</span>
      </div>
      {rows.map((r) => (
        <Row key={r.key} r={r} />
      ))}
      <div className={cn(COLS, "border-t border-fg/14 pt-3")}>
        <span className="text-sm font-semibold">Today</span>
        <span />
        <span className="text-right text-[15px] font-semibold text-ink">{money(c.net_cost)}</span>
        <span className="text-right text-[15px] font-medium text-good">{money(Math.max(0, c.saved))}</span>
      </div>
      {note && <p className="mt-3 mb-0 text-xs leading-[18px] text-ink-faint">{note}</p>}
    </div>
  );
}

function Row({ r }: { r: Line }) {
  return (
    <div className={cn(COLS, "border-t border-line-subtle py-2.5")}>
      <span className="flex min-w-0 items-center gap-2.5">
        <i className="size-2 flex-none rounded-full" style={{ background: r.dot }} />
        <span className="flex min-w-0 flex-col gap-px">
          <span className="truncate text-sm text-ink">{r.label}</span>
          <small className="overflow-hidden text-[11px] text-ellipsis whitespace-nowrap text-ink-faint">{r.sub}</small>
        </span>
      </span>
      <span className="text-right text-[13px] text-ink-muted">{r.kwh}</span>
      <span className="text-right text-sm text-ink">{r.cost}</span>
      <span className={cn("text-right text-sm", r.savedOn ? "font-medium text-good" : "text-ink-faint")}>
        {r.saved}
        {r.savedKwh && <small className="mt-px block text-[11px] font-normal text-ink-faint">{r.savedKwh}</small>}
      </span>
    </div>
  );
}

/** Today rate by rate, a line each: the cost and the saving, with the day's total. */
function List({ rows, c }: { rows: Line[]; c: CostDay }) {
  const line = "flex h-7 min-w-0 items-center gap-2 text-[13px] tabular-nums";
  return (
    <div className="flex flex-col">
      {rows.map((r) => (
        <div key={r.key} className={line} title={r.sub}>
          <i className="size-2 flex-none rounded-full" style={{ background: r.dot }} />
          <span className="min-w-0 flex-1 truncate text-ink-sub">{r.label}</span>
          <span className="w-13 flex-none text-right text-ink">{r.cost}</span>
          <span className={cn("w-13 flex-none text-right", r.savedOn ? "font-medium text-good" : "text-ink-faint")}>
            {r.saved}
          </span>
        </div>
      ))}
      <div className={cn(line, "border-t border-fg/14 font-semibold")}>
        <span className="min-w-0 flex-1 truncate pl-4">Today</span>
        <span className="w-13 flex-none text-right text-ink">{money(c.net_cost)}</span>
        <span className="w-13 flex-none text-right text-good">{money(Math.max(0, c.saved))}</span>
      </div>
    </div>
  );
}

/** Today rate by rate as tiles side by side: each one's cost, and its saving. */
function Strip({ rows }: { rows: Line[] }) {
  return (
    <div className="grid auto-cols-fr grid-flow-col gap-2">
      {rows.map((r) => (
        <div
          key={r.key}
          className="flex min-w-0 flex-col gap-0.5 rounded-2xl bg-fg/4 px-3 py-2 tabular-nums"
          title={r.sub}
        >
          <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] leading-4 text-ink-muted">
            <i className="size-1.5 flex-none rounded-full" style={{ background: r.dot }} />
            <span className="truncate">{r.label}</span>
          </span>
          <span className="truncate text-[15px] leading-5 text-ink">{r.cost}</span>
          <span className={cn("truncate text-[11.5px] leading-4", r.savedOn ? "text-good" : "text-ink-faint")}>
            {r.savedOn ? `Saved ${r.saved}` : " "}
          </span>
        </div>
      ))}
    </div>
  );
}
