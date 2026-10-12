import type { Bills } from "~/features/bills/types";
import type { Tariff } from "~/features/common/tariffs/types";
import { centsPerKwh } from "~/features/bills/utils";
import { Corner, ShareBar, ShareRow } from "~/features/bills/components/BillParts";
import { Card, Muted, TitleBlock } from "~/features/common/ui/components/Card";
import { kWhInt, money } from "~/features/common/formatting/utils/number";
import { bandColor, bandHours, usedBands } from "~/features/common/tariffs/utils";
import { COLOR } from "~/features/common/theme/utils/colors";

const pctOf = (v: number, total: number) => `${Math.round((v / (total || 1)) * 100)}%`;

/**
 * The card's corner: what each kWh the house used cost on average this bill, after solar, the battery and feed-in,
 * against what it would from the grid alone.
 */
function PerKwh({ bills }: { bills: Bills }) {
  const s = bills.current.so_far;
  if (s.home_kwh <= 0) return null;
  const yours = s.net_cost / s.home_kwh;
  const grid = s.without_solar / s.home_kwh;
  return (
    <Corner
      label="Each kWh used"
      value={centsPerKwh(yours)}
      sub={grid > 0 ? `${centsPerKwh(grid)} from the grid alone` : undefined}
    />
  );
}

/** The card's header: the title on the left, what each kWh cost in the corner. */
function Header({ bills, title, sub }: { bills: Bills; title: string; sub: string }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <TitleBlock id="h-tod" title={title} sub={sub} />
      <PerKwh bills={bills} />
    </div>
  );
}

/** Grid spend this bill by rate, where cutting use would help most, and what each kWh used cost in the corner. */
export function CostByRate({
  bills,
  tariff,
  className,
}: {
  bills: Bills;
  tariff: Tariff | undefined;
  className?: string;
}) {
  if (tariff?.type === "amber") return <CostOnAmber bills={bills} className={className} />;
  const tou = tariff?.type === "tou" ? tariff : null;
  const used = tariff ? usedBands(tariff) : null;
  const parts = bills.bands
    .map((b, i) => ({ ...b, i, hours: tou ? bandHours(tou.bands[i]) : "Flat rate" }))
    .filter((b) => !used || used.has(b.i));
  const kwh = parts.reduce((a, b) => a + b.import_kwh, 0);
  const cost = parts.reduce((a, b) => a + b.cost, 0);
  const rate = (i: number) => Number(tou?.bands[i]?.rate) || 0;
  const priciest = tou && parts.length ? parts.reduce((a, b) => (rate(b.i) > rate(a.i) ? b : a)) : null;
  return (
    <Card aria-labelledby="h-tod" className={className}>
      <Header bills={bills} title="What power costs you" sub="Grid spend this bill so far, by rate" />
      <ShareBar parts={parts.map((b) => ({ value: b.cost, color: bandColor(b.i) }))} />
      <div>
        {parts.map((b) => (
          <ShareRow
            key={b.name}
            color={bandColor(b.i)}
            label={tou ? b.name : "All day"}
            sub={`${b.hours} · ${kWhInt(b.import_kwh)}`}
            share={pctOf(b.cost, cost)}
            value={money(b.cost)}
          />
        ))}
      </div>
      <Muted>
        {kwh <= 0
          ? "No power from the grid this bill yet."
          : priciest && priciest.import_kwh < 0.05
            ? `None of it at ${priciest.name.toLowerCase()} rates so far, the dearest.`
            : priciest
              ? `${priciest.name} is ${pctOf(priciest.import_kwh, kwh)} of your grid use and ${pctOf(priciest.cost, cost)} of the spend. Using less ${priciest.hours === "All other times" ? "then" : `from ${priciest.hours}`} saves the most.`
              : "You're on a flat rate, so grid power costs the same all day."}
      </Muted>
    </Card>
  );
}

/** On Amber prices: grid spend at Amber's prices, and anything costed at the fallback rate. */
function CostOnAmber({ bills, className }: { bills: Bills; className?: string }) {
  const [priced, fallback] = bills.bands;
  const parts = [
    { ...priced, color: COLOR.ink, sub: "Priced every 5 or 30 minutes" },
    { ...fallback, color: COLOR.gridLine, sub: "Fallback rate, where Amber had no price" },
  ].filter((b) => b.name && (b === priced || b.import_kwh > 0));
  const kwh = parts.reduce((a, b) => a + b.import_kwh, 0);
  const cost = parts.reduce((a, b) => a + b.cost, 0);
  return (
    <Card aria-labelledby="h-tod" className={className}>
      <Header bills={bills} title="What power costs you" sub="Grid spend this bill so far, at Amber's prices" />
      <ShareBar parts={parts.map((b) => ({ value: b.cost, color: b.color }))} />
      <div>
        {parts.map((b) => (
          <ShareRow
            key={b.name}
            color={b.color}
            label={b.name}
            sub={`${b.sub} · ${kWhInt(b.import_kwh)}${b.import_kwh > 0 ? ` · average ${centsPerKwh(b.cost / b.import_kwh)}` : ""}`}
            share={pctOf(b.cost, cost)}
            value={money(b.cost)}
          />
        ))}
      </div>
      <Muted>
        {kwh <= 0
          ? "No power from the grid this bill yet."
          : "Your price changes through the day. Grid power when it's cheap (often midday) saves the most."}
      </Muted>
    </Card>
  );
}
