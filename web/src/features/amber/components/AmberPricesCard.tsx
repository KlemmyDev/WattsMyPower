import { PriceChart, BUY, SELL } from "~/features/amber/components/PriceChart";
import type { AmberPrices } from "~/features/amber/types";
import { extremes, intervalAt, priceLabel, slots } from "~/features/amber/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { DASH } from "~/features/common/formatting/utils/number";
import { midnight } from "~/features/common/time/utils";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Card, CardHeader, Muted } from "~/features/common/ui/components/Card";
import { cn } from "~/features/common/ui/utils";

const AHEAD = 12; // hours looked ahead for the cheapest and dearest times

function Now({ label, rate, until, sell }: { label: string; rate: number | null; until: string; sell?: boolean }) {
  const costs = sell && rate != null && rate < 0;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-1.5 text-sm text-ink-dim">
        <i className="size-2 flex-none rounded-full" style={{ background: sell ? SELL : BUY }} />
        {label}
      </span>
      <span className="text-[44px] leading-12 font-light tracking-[-1.8px] tabular-nums max-xs:text-[34px] max-xs:leading-10">
        {rate == null ? DASH : priceLabel(rate)}
      </span>
      <span className={cn("text-[13px] tabular-nums", costs ? "text-warn" : "text-ink-label")}>
        {rate == null ? "No price right now" : costs ? "Sending power to the grid costs you" : `per kWh · ${until}`}
      </span>
    </div>
  );
}

/** Overview: what Amber charges and pays right now, today's prices, and the next few hours. */
export function AmberPricesCard({ prices, now }: { prices: AmberPrices; now: number }) {
  const buy = intervalAt(prices.general, now);
  const sell = intervalAt(prices.feed_in, now);
  const current = buy ?? sell;
  const until = current ? `until ${hhmm(current.end)}${current.actual ? "" : " (estimate)"}` : "";
  const hours = slots(prices, now, 6, 3600);
  const ext = extremes(prices, now, AHEAD);

  return (
    <Card aria-labelledby="h-prices" className="col-span-12">
      <CardHeader
        title="Electricity prices"
        id="h-prices"
        action={
          <ButtonLink to="/rates" hash="rates" variant="chip">
            Amber
          </ButtonLink>
        }
      />
      <div className="grid grid-cols-2 gap-4">
        <Now label="Buying now" rate={prices.now.general ?? null} until={until} />
        <Now label="Feed-in now" rate={prices.now.feed_in ?? null} until={until} sell />
      </div>
      <PriceChart prices={prices} day={midnight(now)} now={now} />
      <div className="grid grid-cols-6 gap-px overflow-hidden rounded-2xl bg-line-subtle max-sm:grid-cols-3">
        {hours.map((h, i) => (
          <div key={h.start} className="flex min-w-0 flex-col gap-0.5 bg-surface-inset px-3.5 py-3 max-xs:px-2.5">
            <span className="font-mono text-[11px] text-ink-faint tabular-nums">
              {i === 0 ? "This hour" : hhmm(h.start)}
            </span>
            <span className="text-lg font-medium text-ink tabular-nums">
              {h.buy == null ? DASH : priceLabel(h.buy)}
            </span>
            <span className="text-xs text-ink-dim tabular-nums">
              {h.sell == null ? "" : `Feed-in ${priceLabel(h.sell)}`}
            </span>
          </div>
        ))}
      </div>
      {ext && ext.low.start !== ext.high.start && (
        <Muted>
          In the next {AHEAD} hours, power is cheapest from {hhmm(ext.low.start)} to {hhmm(ext.low.end)} (
          {priceLabel(ext.low.buy as number)}) and dearest from {hhmm(ext.high.start)} to {hhmm(ext.high.end)} (
          {priceLabel(ext.high.buy as number)}). Hourly prices are averages; later ones are forecasts.
        </Muted>
      )}
    </Card>
  );
}
