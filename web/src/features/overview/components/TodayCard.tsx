import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
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
import { dateKey, isWeekend, midnight } from "~/features/common/time/utils";
import { COLOR } from "~/features/common/theme/utils/colors";

/** Today so far: cost and savings, split by rate. */
export function TodayCard({ tariff, now }: { tariff: Tariff | undefined; now: number }) {
  // Today's costs come from the server, priced at the rate in force for each 5 minutes.
  const { data } = useQuery(costsQuery(midnight(now)));
  const c = data?.days.find((d) => d.date === dateKey(now));
  const t = c && tariff;
  return (
    <Card aria-labelledby="h-today" className="col-span-6 gap-6 max-lg:col-span-12">
      <CardHeader
        title="Today so far"
        id="h-today"
        action={
          <ButtonLink to="/bills/rates" hash="rates" variant="chip">
            {t ? RATE_TYPE[t.type] : "Rates"}
          </ButtonLink>
        }
      />
      {c && t ? <Figures c={c} /> : <Figures />}
      {c && t && (t.type === "amber" ? <AmberTable c={c} /> : <RateTable c={c} t={t} now={now} />)}
    </Card>
  );
}

function Figures({ c }: { c?: CostDay }) {
  const wo = c ? c.net_cost + c.saved : 0; // what today would have cost without solar and the battery
  // In credit when feed-in is worth more than today's usage and supply charge.
  const credit = !!c && c.net_cost < 0;
  const paid = !c || credit ? "0" : `${wo > 0 ? Math.max(2, Math.min(100, (c.net_cost / wo) * 100)).toFixed(1) : 2}%`;
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <Figure
          k={credit ? "Credit today" : "Cost today"}
          v={c ? money(Math.abs(c.net_cost)) : "—"}
          good={credit}
          sub={credit ? "Feed-in credit covers your costs so far" : "Including the daily supply charge"}
        />
        <Figure
          k="Saved today"
          v={c ? money(Math.max(0, c.saved)) : "—"}
          good
          sub={c ? `Without solar you'd pay ${money(wo)}` : " "}
        />
      </div>
      <div className="flex flex-col gap-2.5">
        <div className="flex h-2 overflow-hidden rounded-full bg-track">
          <div
            className="origin-left animate-fill-x bg-ink transition-[width] duration-320 ease-out-soft"
            style={{ width: paid }}
          />
          <div className="flex-1 bg-good" />
        </div>
        <div className="flex justify-between gap-3 text-xs text-ink-label tabular-nums max-xs:flex-col max-xs:gap-1">
          <span className="flex items-center gap-1.5">
            <i className="size-2 flex-none rounded-full bg-ink" />
            <span>{c && (credit ? `In credit ${money(-c.net_cost)}` : `You pay ${money(c.net_cost)}`)}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span>{c && `Solar and battery cover ${money(Math.max(0, c.saved))}`}</span>
            <i className="size-2 flex-none rounded-full bg-good" />
          </span>
        </div>
      </div>
    </>
  );
}

function Figure({ k, v, sub, good }: { k: string; v: string; sub: string; good?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm text-ink-dim">{k}</span>
      <span
        className={cn(
          "text-[56px] leading-[60px] font-light tracking-[-2.5px] tabular-nums max-xs:text-[40px] max-xs:leading-[44px] max-xs:tracking-[-1.5px]",
          good ? "text-good" : "text-ink",
        )}
      >
        {v}
      </span>
      <span className="text-[13px] text-ink-label tabular-nums">{sub}</span>
    </div>
  );
}

const RATE_TYPE: Record<Tariff["type"], string> = { flat: "Single rate", tou: "Time of use", amber: "Amber" };

const COLS =
  "grid grid-cols-[minmax(0,1.6fr)_minmax(64px,0.8fr)_minmax(64px,0.8fr)_minmax(64px,0.8fr)] items-center gap-3 tabular-nums max-xs:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(52px,0.8fr))] max-xs:gap-2";

function RateTable({ c, t, now }: { c: CostDay; t: Tariff; now: number }) {
  const tou = t.type === "tou";
  const used = usedBands(t);
  const d = new Date(now * 1000);
  const nowMin = d.getHours() * 60 + d.getMinutes();
  const today = bandTable(t, isWeekend(d) ? "weekend" : "weekday").tab;
  const startsAt = (i: number) => {
    const m = today.findIndex((x, k) => k >= nowMin && x === i);
    return m < 0 ? null : minutesLabel(m);
  };
  const bands = c.bands
    .map((b, i) => ({ ...b, i }))
    .filter((b) => used.has(b.i) || b.import_kwh > 0 || b.home_kwh > 0)
    .sort((x, y) => x.rate - y.rate);
  const feedIn = tariffNumber(t.feed_in_rate);

  return (
    <div className="flex flex-col">
      <div className={cn(COLS, "pb-2 font-mono text-[10px] tracking-[1px] text-ink-faint uppercase")}>
        <span>Period</span>
        <span className="text-right">From grid</span>
        <span className="text-right">Cost</span>
        <span className="text-right">Saved</span>
      </div>
      {bands.map((b) => {
        const notYet = tou && b.home_kwh < 0.005 && !today.slice(0, nowMin).includes(b.i);
        const at = notYet && startsAt(b.i);
        return at ? (
          <Row
            key={b.i}
            dot={bandColor(b.i)}
            label={b.name}
            sub={`Starts ${at} · ${centsShort(b.rate)} per kWh`}
            cost="–"
            saved="–"
            savedOn={false}
          />
        ) : (
          <Row
            key={b.i}
            dot={tou ? bandColor(b.i) : COLOR.gridLine}
            label={tou ? b.name : "Single rate"}
            sub={`${centsShort(b.rate)} per kWh`}
            kwh={kWh(b.import_kwh)}
            cost={money(b.cost)}
            saved={money(Math.max(0, b.saved))}
            savedKwh={kWh(b.self_kwh)}
          />
        );
      })}
      <Row
        dot={COLOR.barFaint}
        label="Supply charge"
        sub="Fixed daily charge"
        cost={money(c.supply)}
        saved="–"
        savedOn={false}
      />
      <Row
        dot={COLOR.solar}
        label="Solar credit"
        sub={`Exported at ${centsShort(feedIn)} per kWh`}
        cost={money(-c.feed_in_credit)}
        saved={money(c.feed_in_credit)}
        savedKwh={kWh(c.export_kwh)}
      />
      <div className={cn(COLS, "border-t border-fg/14 pt-3")}>
        <span className="text-sm font-semibold">Today</span>
        <span />
        <span className="text-right text-[15px] font-semibold text-ink">{money(c.net_cost)}</span>
        <span className="text-right text-[15px] font-medium text-good">{money(Math.max(0, c.saved))}</span>
      </div>
    </div>
  );
}

/**
 * Today on Amber prices: grid power at the prices of the time (with its average), anything costed at the
 * fallback rate because Amber had no price, the supply charge, and feed-in at the prices of the time
 * (which can cost money when the feed-in price is negative).
 */
function AmberTable({ c }: { c: CostDay }) {
  const [priced, fallback] = c.bands;
  const fit = c.feed_in_rate;
  const unpriced = c.unpriced_kwh ?? 0;
  return (
    <div className="flex flex-col">
      <div className={cn(COLS, "pb-2 font-mono text-[10px] tracking-[1px] text-ink-faint uppercase")}>
        <span>Period</span>
        <span className="text-right">From grid</span>
        <span className="text-right">Cost</span>
        <span className="text-right">Saved</span>
      </div>
      {priced && (
        <Row
          dot={COLOR.ink}
          label="Amber prices"
          sub={`${priced.import_kwh > 0 ? "Average" : "Today's average"} ${priceLabel(priced.rate)} per kWh`}
          kwh={kWh(priced.import_kwh)}
          cost={money(priced.cost)}
          saved={money(Math.max(0, priced.saved))}
          savedKwh={kWh(priced.self_kwh)}
        />
      )}
      {fallback && (fallback.import_kwh > 0 || fallback.home_kwh > 0) && (
        <Row
          dot={COLOR.gridLine}
          label="No Amber price"
          sub={`Fallback rate ${centsShort(fallback.rate)} per kWh`}
          kwh={kWh(fallback.import_kwh)}
          cost={money(fallback.cost)}
          saved={money(Math.max(0, fallback.saved))}
          savedKwh={kWh(fallback.self_kwh)}
        />
      )}
      <Row
        dot={COLOR.barFaint}
        label="Supply charge"
        sub="Fixed daily charge"
        cost={money(c.supply)}
        saved="–"
        savedOn={false}
      />
      <Row
        dot={COLOR.solar}
        label={c.feed_in_credit < 0 ? "Solar export cost" : "Solar credit"}
        sub={fit != null ? `Exported at an average ${priceLabel(fit)} per kWh` : "Nothing exported yet"}
        cost={money(-c.feed_in_credit)}
        saved={money(c.feed_in_credit)}
        savedOn={c.feed_in_credit >= 0}
        savedKwh={kWh(c.export_kwh)}
      />
      <div className={cn(COLS, "border-t border-fg/14 pt-3")}>
        <span className="text-sm font-semibold">Today</span>
        <span />
        <span className="text-right text-[15px] font-semibold text-ink">{money(c.net_cost)}</span>
        <span className="text-right text-[15px] font-medium text-good">{money(Math.max(0, c.saved))}</span>
      </div>
      {unpriced >= 0.05 && (
        <p className="mt-3 mb-0 text-xs leading-[18px] text-ink-faint">
          {kWh(unpriced)} was costed at your fallback rates, because Amber had no price for those times yet.
        </p>
      )}
    </div>
  );
}

/** One rate row. savedKwh is the energy behind the saving (home use covered by solar or the battery, or kWh exported). */
function Row({
  dot,
  label,
  sub,
  kwh,
  cost,
  saved,
  savedOn = true,
  savedKwh,
}: {
  dot: string;
  label: string;
  sub: string;
  kwh?: string;
  cost: ReactNode;
  saved: ReactNode;
  savedOn?: boolean;
  savedKwh?: string;
}) {
  return (
    <div className={cn(COLS, "border-t border-line-subtle py-2.5")}>
      <span className="flex min-w-0 items-center gap-2.5">
        <i className="size-2 flex-none rounded-full" style={{ background: dot }} />
        <span className="flex min-w-0 flex-col gap-px">
          <span className="text-sm text-ink">{label}</span>
          <small className="overflow-hidden text-[11px] text-ellipsis whitespace-nowrap text-ink-faint">{sub}</small>
        </span>
      </span>
      <span className="text-right text-[13px] text-ink-muted">{kwh}</span>
      <span className="text-right text-sm text-ink">{cost}</span>
      <span className={cn("text-right text-sm", savedOn ? "font-medium text-good" : "text-ink-faint")}>
        {saved}
        {savedKwh && <small className="mt-px block text-[11px] font-normal text-ink-faint">{savedKwh}</small>}
      </span>
    </div>
  );
}
