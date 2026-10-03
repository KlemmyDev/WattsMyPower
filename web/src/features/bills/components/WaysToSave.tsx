import type { ReactNode } from "react";
import type { BillTip, Bills } from "~/features/bills/types";
import type { Tariff } from "~/features/common/tariffs/types";
import { ButtonLink } from "~/features/common/ui/components/Button";
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
              ? `Running the dishwasher, washing machine or dryer while the panels are sending power to the grid uses solar that only earns ${centsShort(tip.to_rate)} instead.`
              : `Running the dishwasher, washing machine or dryer in ${tip.to.toLowerCase()} hours costs ${centsShort(tip.to_rate)} a kWh instead.`}{" "}
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
            You send {kWh(tip.export_kwh_day)} a day to the grid for {centsShort(tip.feed_in)} a kWh, and buy grid power
            at {centsShort(tip.import_price)} on average. Running appliances, the pool pump or a hot water timer in the
            middle of the day would use about {kWh(tip.moved_kwh_day)} a day more of it.
          </>
        ),
      };
    case "baseload":
      return {
        title: "Trim what's always on",
        body: (
          <>
            About {tip.watts} W runs around the clock, even at 3am: {kWh(tip.kwh_day)} a day, about {dollars(tip.cost)}{" "}
            a bill.{" "}
            {tip.grid_share >= 0.5
              ? `Most of it comes from the grid overnight, at ${centsShort(tip.night_rate)} a kWh.`
              : "The battery covers most of it overnight, so it mostly costs the feed-in that solar would have earned."}{" "}
            An old fridge or freezer, a pool pump, or devices left on standby are the usual causes. The saving is for{" "}
            {tip.cut_watts} W less.
          </>
        ),
      };
    case "supply":
      return {
        title: "Compare plans: the supply charge is a big part of this bill",
        body: (
          <>
            The daily supply charge ({money(tip.per_day)} a day) is {Math.round(tip.share * 100)}% of what you pay
            before feed-in, {dollars(tip.cost)} a bill. Using less power doesn't change it; a plan with a lower supply
            charge does.
          </>
        ),
        action: (
          <ButtonLink to="/settings/tariffs" variant="link" size="sm">
            Find a plan
          </ButtonLink>
        ),
      };
  }
}

/** Ways to lower this bill, from the household's own recent days, with what each is worth over a bill. */
export function WaysToSave({ bills, tariff }: { bills: Bills; tariff: Tariff | undefined }) {
  const tips = bills.tips;
  const days = bills.current.so_far.days;
  return (
    <Card aria-labelledby="h-ways">
      <TitleBlock
        id="h-ways"
        title="Ways to lower this bill"
        sub="Worked out from your last 30 days at your current rates. Savings are for a whole bill, and roughly what each change is worth."
      />
      {tips.length === 0 ? (
        <Muted>
          {days < 3
            ? "Suggestions show up after a few days of readings."
            : "Nothing stands out: your grid use, feed-in and always-on use are already low for your rates."}
        </Muted>
      ) : (
        <ol className="flex flex-col">
          {tips.map((tip, i) => {
            const { title, body, action } = say(tip, bills, tariff);
            return (
              <li
                key={tip.kind}
                className="grid grid-cols-[28px_1fr_auto] items-start gap-x-4 gap-y-1 border-b border-line-subtle py-4 last:border-b-0 max-sm:grid-cols-[28px_1fr]"
              >
                <span className="flex size-7 items-center justify-center rounded-full bg-track text-xs font-semibold text-ink">
                  {i + 1}
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-[15px] font-semibold text-ink">{title}</span>
                  <span className="text-[13px] leading-5 text-pretty text-ink-muted">{body}</span>
                  {action && <span className="pt-1">{action}</span>}
                </div>
                <div className="flex flex-col items-end gap-0.5 text-right max-sm:col-start-2 max-sm:items-start max-sm:text-left">
                  {tip.saving != null ? (
                    <>
                      <span className="text-lg font-semibold text-good tabular-nums">about {dollars(tip.saving)}</span>
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
