import { useAmberPrices } from "~/features/amber/hooks";
import { BillDays } from "~/features/bills/components/BillDays";
import type { Bills } from "~/features/bills/types";
import { billAmount, billCents, ymdLabel } from "~/features/bills/utils";
import { ON } from "~/features/common/energy/utils";
import { centsShort, DASH, dollars, kW, kWhInt, money, plural } from "~/features/common/formatting/utils/number";
import type { Snapshot } from "~/features/common/live/types";
import type { Tariff } from "~/features/common/tariffs/types";
import { tariffNumber } from "~/features/common/tariffs/utils";
import { COLOR } from "~/features/common/theme/utils/colors";
import { midnight } from "~/features/common/time/utils";
import { Card } from "~/features/common/ui/components/Card";
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
import { rateAt } from "~/features/home/components/RateStrip";
import { useRates } from "~/features/home/hooks";

/** Bills' colour, as the navigation has it. */
export const BILL = COLOR.good;

/**
 * What this bill's measured against: the last bill, when it was recorded the whole way through (a part-recorded one
 * would look cheap), else the budget set in Rates & settings. Null with neither.
 */
export function billReference(bills: Bills): { value: number; label: string } | null {
  const last = bills.past.at(-1);
  if (last && last.recorded >= last.days - 2) return { value: last.net_cost, label: "last bill" };
  if (bills.budget) return { value: bills.budget, label: "budget" };
  return null;
}

/**
 * This bill so far and now, in one card, as Solar's and Home's: what it's come to so far and where it's heading by the
 * end of the period (against the last bill or the budget), what the house is costing (or earning) an hour right now,
 * what was bought, the feed-in credit, the supply charge and what solar and the battery saved; the period's pace along
 * a bar; and, unless `chart` is off, every day of the period as a bar of what it cost, the days ahead as expected.
 */
export function BillHero({
  bills,
  failed,
  tariff,
  p,
  now,
  chart = true,
}: {
  bills: Bills | undefined;
  failed?: boolean;
  tariff: Tariff | undefined;
  p: Snapshot | null;
  now: number;
  chart?: boolean;
}) {
  if (!bills)
    return failed ? (
      <Card aria-label="This bill so far" className="h-full">
        <span className="text-[13px] text-ink-muted">
          Couldn't reach the server for your bills. Try again in a moment.
        </span>
      </Card>
    ) : (
      <Skeleton className={chart ? "h-[560px] rounded-3xl" : "h-[230px] rounded-3xl"} />
    );
  const s = bills.current.so_far;
  const exp = bills.current.expected;
  const ref = billReference(bills);
  const diff = exp && ref ? exp.net_cost - ref.value : null;
  const [value, unit] = s.net_cost < 0 ? [money(-s.net_cost), "credit"] : [money(s.net_cost)];
  const off = s.discount + s.credits;
  return (
    <HeroCard label="This bill so far and now" tint={BILL}>
      <HeroTop>
        <HeroFigures>
          <HeroLead
            label="This bill so far"
            value={value}
            unit={unit}
            sub={
              <>
                {exp
                  ? `Heading for ${billAmount(exp.net_cost)} by ${ymdLabel(bills.period.end)}`
                  : "Where it's heading shows after a full day"}
                {off > 0.005 && <span>after {money(off)} off</span>}
                {diff != null && ref && (
                  <Delta value={diff} invert>
                    {Math.abs(diff) < 1
                      ? `Level with your ${ref.label}`
                      : `${dollars(Math.abs(diff))} ${diff > 0 ? "over" : "under"} your ${ref.label}`}
                  </Delta>
                )}
              </>
            }
          />
          <CostNow p={p} tariff={tariff} now={now} />
        </HeroFigures>
        <HeroStats>
          <HeroStat label="Bought" value={money(s.import_cost)} sub={`${kWhInt(s.import_kwh)} from the grid`} />
          <HeroStat
            label="Feed-in credit"
            // On Amber, a negative feed-in price makes sending power out cost money.
            value={money(s.feed_in_credit ? -s.feed_in_credit : 0)}
            sub={`${kWhInt(s.export_kwh)} sent out`}
          />
          <HeroStat
            label="Supply"
            value={money(s.supply)}
            sub={s.days ? `${s.days} ${plural(s.days, "day")} at ${money(s.supply / s.days)}` : undefined}
          />
          <HeroStat
            label="Saved"
            value={dollars(Math.max(0, Math.round(s.without_solar) - Math.round(s.net_cost)))}
            sub={`On ${dollars(s.without_solar)} grid only`}
          />
        </HeroStats>
      </HeroTop>
      <Pace bills={bills} reference={ref} />
      {chart && <BillDays bills={bills} />}
    </HeroCard>
  );
}

/**
 * What the house is costing an hour right now: what it's buying from the grid at the rate now, or earning for what it
 * sends out at the feed-in rate. Nothing while solar and the battery cover it all.
 */
function CostNow({ p, tariff, now }: { p: Snapshot | null; tariff: Tariff | undefined; now: number }) {
  const rate = rateAt(useRates(midnight(now)), now);
  const amber = useAmberPrices(now, tariff?.type === "amber");
  const feedIn =
    amber?.now.feed_in ?? (tariff && tariff.feed_in_rate !== "" ? tariffNumber(tariff.feed_in_rate) : null);
  const grid = p?.grid_power ?? null;
  const buying = grid != null && grid > ON;
  const selling = grid != null && grid < -ON;
  const perHour = buying && rate ? (grid / 1000) * rate.rate : selling && feedIn != null ? (-grid / 1000) * feedIn : 0;
  const [value, unit] =
    grid == null || (buying && !rate) || (selling && feedIn == null)
      ? [DASH, undefined]
      : Math.abs(perHour) < 1
        ? [`${Math.round(Math.abs(perHour) * 100)}c`, "an hour"]
        : [money(Math.abs(perHour)), "an hour"];
  return (
    <HeroLive
      label={selling ? "Earning now" : "Costing now"}
      on={buying || selling}
      color={selling ? COLOR.export : COLOR.import}
      value={value}
      unit={unit}
      sub={
        grid == null
          ? "No reading yet"
          : buying
            ? `Buying ${kW(grid)}${rate ? ` at ${centsShort(rate.rate)}/kWh` : ""}`
            : selling
              ? `Sending ${kW(-grid)} out${feedIn != null ? ` at ${centsShort(feedIn)}/kWh` : ""}`
              : "Solar and the battery have the house covered"
      }
    />
  );
}

/**
 * The period's pace along one bar out of where it's heading: the bill so far (the figure above it), the rest expected
 * (dashed), and a tick for the last bill or the budget.
 */
function Pace({ bills, reference }: { bills: Bills; reference: { value: number; label: string } | null }) {
  const so = Math.max(0, bills.current.so_far.net_cost);
  const expected = bills.current.expected?.net_cost ?? null;
  const whole = Math.max(so, expected ?? 0, reference?.value ?? 0, 0.01);
  const at = (v: number) => (Math.max(0, v) / whole) * 100;
  const { day, days } = bills.period;
  return (
    <HeroBar
      legend={
        <>
          <HeroKey mark="dot" color={BILL}>
            {billCents(bills.current.so_far.net_cost)} so far · day {day} of {days}
          </HeroKey>
          {reference && (
            <HeroKey mark="tick">
              {billAmount(reference.value)} {reference.label}
            </HeroKey>
          )}
          {expected != null && (
            <HeroKey mark="dashed" color={BILL}>
              About {billAmount(expected)} by {ymdLabel(bills.period.end)}
            </HeroKey>
          )}
        </>
      }
    >
      {expected != null && <HeroFill to={at(expected)} color={BILL} variant="dashed" />}
      <HeroFill to={at(so)} color={BILL} />
      {reference && reference.value > 0 && (
        <HeroTick at={at(reference.value)} title={`Your ${reference.label}, ${billAmount(reference.value)}`} />
      )}
    </HeroBar>
  );
}
