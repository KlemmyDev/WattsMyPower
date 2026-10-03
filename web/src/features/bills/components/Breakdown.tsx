import type { Bills } from "~/features/bills/types";
import type { Tariff } from "~/features/common/tariffs/types";
import { billAmount, billCents, centsPerKwh } from "~/features/bills/utils";
import { ShareBar, ShareRow, StatGrid } from "~/features/bills/components/BillParts";
import { Card, Muted, TitleBlock } from "~/features/common/ui/components/Card";
import { DASH, dollars, kWhInt, money, plural } from "~/features/common/formatting/utils/number";
import { bandColor, bandHours, usedBands } from "~/features/common/tariffs/utils";

const pctOf = (v: number, total: number) => `${Math.round((v / (total || 1)) * 100)}%`;
const PACE_DAYS = 3; // full days of this period before judging its pace
const bigFigure = "font-display text-[44px] leading-12 font-light tracking-[-1.8px] tabular-nums";

/** This period's bill so far, split into home use from the grid, supply, and feed-in credit. */
export function PaidFor({ bills }: { bills: Bills }) {
  const s = bills.current.so_far;
  const gross = s.import_cost + s.supply;
  return (
    <Card aria-labelledby="h-paid">
      <TitleBlock
        id="h-paid"
        title="What you paid for"
        sub={`This period so far · ${billCents(s.net_cost)} in total`}
      />
      <ShareBar
        parts={[
          { value: s.import_cost, color: "#f5f5f5" },
          { value: s.supply, color: "#5a5a60" },
        ]}
      />
      <div>
        <ShareRow
          color="#f5f5f5"
          label="Home use from the grid"
          share={pctOf(s.import_cost, gross)}
          value={money(s.import_cost)}
        />
        <ShareRow
          color="#5a5a60"
          label={`Supply charge · ${s.days} ${plural(s.days, "day")}`}
          share={pctOf(s.supply, gross)}
          value={money(s.supply)}
        />
        <ShareRow
          color="#ffb547"
          label="Feed-in credit"
          value={money(s.feed_in_credit ? -s.feed_in_credit : 0)} // on Amber, a negative feed-in price costs money
        />
      </div>
    </Card>
  );
}

/** Grid spend this period by tariff rate, and where cutting use would help most. */
export function CostByTime({ bills, tariff }: { bills: Bills; tariff: Tariff | undefined }) {
  if (tariff?.type === "amber") return <CostOnAmber bills={bills} />;
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
    <Card aria-labelledby="h-tod">
      <TitleBlock id="h-tod" title="Cost by time of day" sub="Grid spend this period so far, by tariff period" />
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
          ? "No power from the grid this period yet."
          : priciest
            ? `${priciest.name} hours are ${pctOf(priciest.import_kwh, kwh)} of your grid use and ${pctOf(priciest.cost, cost)} of your grid spend. Using less power ${priciest.hours === "All other times" ? "at those times" : `from ${priciest.hours}`} lowers your bill the most.`
            : "You are on a flat rate, so grid power costs the same at any time of day."}
      </Muted>
    </Card>
  );
}

/** On Amber prices: grid spend at Amber's prices, and anything costed at the fallback rate. */
function CostOnAmber({ bills }: { bills: Bills }) {
  const [priced, fallback] = bills.bands;
  const parts = [
    { ...priced, color: "#f5f5f5", sub: "Priced every 5 or 30 minutes" },
    { ...fallback, color: "#9a9aa3", sub: "Fallback rate, where Amber had no price" },
  ].filter((b) => b.name && (b === priced || b.import_kwh > 0));
  const kwh = parts.reduce((a, b) => a + b.import_kwh, 0);
  const cost = parts.reduce((a, b) => a + b.cost, 0);
  return (
    <Card aria-labelledby="h-tod">
      <TitleBlock id="h-tod" title="Cost of grid power" sub="Grid spend this period so far, at Amber's prices" />
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
          ? "No power from the grid this period yet."
          : "Your price changes through the day. Using grid power when prices are low, often the middle of the day, lowers your bill the most."}
      </Muted>
    </Card>
  );
}

/** Whether spending so far is heading above or below the expected total. */
export function BillPace({ bills }: { bills: Bills }) {
  const exp = bills.current.expected;
  const whole = bills.days.filter((d) => !d.partial);
  const run =
    whole.length >= PACE_DAYS ? (whole.reduce((a, d) => a + d.net_cost, 0) / whole.length) * bills.period.days : null;
  const diff = exp && run != null ? run - exp.net_cost : null;
  const tol = exp ? Math.max(5, Math.abs(exp.net_cost) * 0.05) : 0;
  const [status, color, note] =
    diff == null
      ? [DASH, "#f5f5f5", `Shows up after the first ${PACE_DAYS} full days of this period.`]
      : Math.abs(diff) <= tol
        ? ["On track", "#f5f5f5", "Your spending so far is in line with the expected total."]
        : diff > 0
          ? [
              "Above expected",
              "#ffb547",
              `At your current daily rate this bill would be ${dollars(diff)} more than expected.`,
            ]
          : [
              "Below expected",
              "#3ee08f",
              `At your current daily rate this bill would be ${dollars(-diff)} less than expected.`,
            ];
  return (
    <Card aria-labelledby="h-pace">
      <TitleBlock id="h-pace" title="Bill pace" sub="Your daily spend so far compared with the expected total" />
      <div className="flex flex-col gap-1.5">
        <div className={bigFigure} style={{ color }}>
          {status}
        </div>
        <Muted>{note}</Muted>
      </div>
      <StatGrid
        min={150}
        className="mt-auto"
        stats={[
          { label: "At your current daily rate", value: run != null ? billAmount(run) : DASH },
          { label: "Expected total", value: exp ? billAmount(exp.net_cost) : DASH },
        ]}
      />
    </Card>
  );
}

/** What each kWh the home used cost after solar, battery and feed-in, against buying it all from the grid. */
export function CostPerKwh({ bills }: { bills: Bills }) {
  const s = bills.current.so_far;
  const yours = s.home_kwh > 0 ? s.net_cost / s.home_kwh : null;
  const grid = s.home_kwh > 0 ? s.without_solar / s.home_kwh : null;
  const rows: [string, number | null, string][] = [
    ["Your cost", yours, "#f5f5f5"],
    ["Grid only, no solar", grid, "#5a5a60"],
  ];
  return (
    <Card aria-labelledby="h-per-kwh">
      <TitleBlock
        id="h-per-kwh"
        title="Cost per kWh used"
        sub="Average cost of every kWh your home used this period, after solar, battery, and feed-in credit"
      />
      <div className="flex flex-wrap items-baseline gap-2.5">
        <span className={bigFigure}>{yours != null ? centsPerKwh(yours) : DASH}</span>
        {yours != null && grid && (
          <span className="text-sm text-ink-muted">
            per kWh · {Math.round((1 - yours / grid) * 100)}% less than grid only
          </span>
        )}
      </div>
      <div className="mt-auto flex flex-col gap-3.5">
        {rows.map(([label, v, color]) => (
          <div key={label} className="grid grid-cols-[minmax(120px,160px)_1fr_52px] items-center gap-3.5">
            <span className="text-[13px] text-ink-muted">{label}</span>
            <div className="h-3 rounded-full bg-popover">
              <div
                className="h-full min-w-3 rounded-full"
                style={{
                  width: `${v != null && grid ? ((Math.max(0, v) / grid) * 100).toFixed(1) : 0}%`,
                  background: color,
                }}
              />
            </div>
            <span className="text-right text-sm font-semibold text-ink tabular-nums">
              {v != null ? centsPerKwh(v) : DASH}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
