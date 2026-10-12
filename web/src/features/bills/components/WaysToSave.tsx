import type { ReactNode } from "react";
import type { BillTip, Bills } from "~/features/bills/types";
import type { Tariff } from "~/features/common/tariffs/types";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Corner } from "~/features/bills/components/BillParts";
import { Card, Muted, TitleBlock } from "~/features/common/ui/components/Card";
import { bandHours } from "~/features/common/tariffs/utils";
import { centsShort, dollars, kWh, money } from "~/features/common/formatting/utils/number";

type Said = { title: string; body: ReactNode; action?: ReactNode };

/** A tip in words: what to change, and why it's worth it. */
function say(tip: BillTip, bills: Bills, tariff: Tariff | undefined): Said {
  switch (tip.kind) {
    case "peak": {
      const name = bills.bands[tip.band]?.name ?? "peak";
      const band = tariff?.type === "tou" ? tariff.bands[tip.band] : undefined;
      const hours = band ? ` (${bandHours(band).toLowerCase()})` : "";
      return {
        title:
          tip.to === "solar"
            ? `Move some ${name.toLowerCase()} use into the middle of the day`
            : `Move some ${name.toLowerCase()} use to ${tip.to.toLowerCase()} hours`,
        body: (
          <>
            {kWh(tip.kwh_day)} a day comes from the grid in {name.toLowerCase()} hours{hours}, at {centsShort(tip.rate)}{" "}
            a kWh.{" "}
            {tip.to === "solar"
              ? `Run the dishwasher, washing machine or dryer while solar is going out to the grid, and it only costs you the ${centsShort(tip.to_rate)} that solar would have earned.`
              : `Run the dishwasher, washing machine or dryer in ${tip.to.toLowerCase()} hours instead, at ${centsShort(tip.to_rate)} a kWh.`}{" "}
            The saving is for moving a quarter of it, about {kWh(tip.moved_kwh_day)} a day.
          </>
        ),
      };
    }
    case "solar":
      return {
        title: "Use more of your own solar",
        body: (
          <>
            You send {kWh(tip.export_kwh_day)} a day to the grid for {centsShort(tip.feed_in)} a kWh, but pay{" "}
            {centsShort(tip.import_price)} on average for grid power. Run appliances, the pool pump or a hot water timer
            in the middle of the day and you'd keep about {kWh(tip.moved_kwh_day)} a day more of it.
          </>
        ),
      };
    case "baseload":
      return {
        title: "Trim what's always on",
        body: (
          <>
            About {tip.watts} W runs around the clock, even at 3 am. That's {kWh(tip.kwh_day)} a day, or about{" "}
            {dollars(tip.cost)} a bill.{" "}
            {tip.grid_share >= 0.5
              ? `Most of it comes from the grid overnight, at ${centsShort(tip.night_rate)} a kWh.`
              : "Your battery covers most of it overnight, so it mostly costs you the feed-in that solar would have earned."}{" "}
            The usual culprits are an old fridge or freezer, a pool pump, or things left on standby. The saving is for
            cutting {tip.cut_watts} W.
          </>
        ),
      };
    case "supply":
      return {
        title: "Look for a plan with a lower supply charge",
        body: (
          <>
            At {money(tip.per_day)} a day, the supply charge is {Math.round(tip.share * 100)}% of what you pay before
            feed-in, or {dollars(tip.cost)} a bill. Using less power won't change it, but a cheaper plan will.
          </>
        ),
        action: (
          <ButtonLink to="/bills/rates" hash="rates" variant="link" size="sm">
            Find a plan
          </ButtonLink>
        ),
      };
  }
}

/** Ways to lower this bill, from the household's own recent days, with what each is worth over a bill. */
export function WaysToSave({
  bills,
  tariff,
  className,
}: {
  bills: Bills;
  tariff: Tariff | undefined;
  className?: string;
}) {
  const tips = bills.tips;
  const days = bills.current.so_far.days;
  const worth = tips.reduce((a, t) => a + (t.saving ?? 0), 0);
  return (
    <Card aria-labelledby="h-ways" className={className}>
      <div className="flex items-end justify-between gap-4">
        <TitleBlock id="h-ways" title="Ways to pay less" sub="From your last 30 days at today's rates" />
        {worth >= 1 && <Corner label="Worth about" value={dollars(worth)} sub="a bill, roughly" />}
      </div>
      {tips.length === 0 ? (
        <Muted>
          {days < 3
            ? "Suggestions show up after a few days of readings."
            : "Nothing stands out. Your grid use, feed-in and always-on use are already low for your rates."}
        </Muted>
      ) : (
        <ol className="flex flex-col">
          {tips.map((tip, i) => {
            const { title, body, action } = say(tip, bills, tariff);
            return (
              <li
                key={tip.kind}
                className="grid grid-cols-[28px_1fr_auto] items-start gap-x-4 gap-y-1 border-b border-line-subtle py-3.5 first:pt-0 last:border-b-0 last:pb-0 max-sm:grid-cols-[28px_1fr]"
              >
                <span className="flex size-7 items-center justify-center rounded-full bg-track text-xs font-semibold text-ink">
                  {i + 1}
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-[15px] font-medium text-ink">{title}</span>
                  <span className="text-[13px] leading-5 text-pretty text-ink-muted">{body}</span>
                  {action && <span className="pt-1">{action}</span>}
                </div>
                <div className="flex flex-col items-end gap-0.5 text-right max-sm:col-start-2 max-sm:items-start max-sm:text-left">
                  {tip.saving != null ? (
                    <>
                      <span className="text-[17px] font-light text-good tabular-nums">{dollars(tip.saving)}</span>
                      <span className="text-xs text-ink-faint">a bill</span>
                    </>
                  ) : (
                    <span className="text-xs text-ink-faint">Depends on the plan</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
