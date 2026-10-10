import { useSystem } from "~/features/common/live/hooks/useSystem";
import { dollars } from "~/features/common/formatting/utils/number";
import { COLOR } from "~/features/common/theme/utils/colors";
import { SummaryCard, SummaryStat } from "~/features/common/ui/components/Summary";
import type { Tariff } from "~/features/common/tariffs/types";

const c = (v: number | "" | undefined) => (v === "" || v == null ? "—" : `${+(v * 100).toFixed(2)}c`);

const OFTEN: Record<number, string> = { 1: "Monthly", 2: "Every 2 months", 3: "Quarterly" };

/** What grid power costs on these rates, in a few words: the rate, or Time of use's cheapest to dearest. */
function importRate(t: Tariff): [value: string, sub: string] {
  if (t.type === "amber") return ["Amber", "Its price for every 5 or 30 minutes"];
  if (t.type === "flat") return [c(t.flat_rate), "Per kWh, at any time"];
  const rates = t.bands.map((b) => b.rate).filter((r): r is number => r !== "");
  if (!rates.length) return ["Time of use", "Rates not set"];
  const lo = Math.min(...rates);
  const hi = Math.max(...rates);
  return [lo === hi ? c(lo) : `${c(lo)}–${c(hi)}`, `Time of use, ${t.bands.length} rates`];
}

/** Bills → Rates & settings, the top: where the rates come from, what they are, and when bills come. */
export function RatesSummary() {
  const s = useSystem();
  const t = s?.tariff;
  const [rate, rateSub] = t ? importRate(t) : ["—", ""];
  return (
    <SummaryCard icon="tag" color={COLOR.good} label="Your rates">
      <SummaryStat
        label="Grid power"
        value={rate}
        sub={t?.source ? `${t.source.brand} · ${t.source.plan_name}` : rateSub}
        title={t?.source ? `${t.source.brand} · ${t.source.plan_name}` : undefined}
      />
      <SummaryStat label="Feed-in" value={t?.type === "amber" ? "Amber" : c(t?.feed_in_rate)} sub="Per kWh sent" />
      <SummaryStat
        label="Supply charge"
        value={t?.supply_charge === "" || t?.supply_charge == null ? "—" : `$${(+t.supply_charge).toFixed(2)}`}
        sub="A day"
      />
      <SummaryStat
        label="Billed"
        value={s ? (OFTEN[s.bill_months] ?? `Every ${s.bill_months} months`) : "—"}
        sub={s ? `From day ${s.bill_day} of the month` : undefined}
      />
      <SummaryStat
        label="Budget"
        value={s?.bill_budget ? dollars(s.bill_budget) : "None"}
        sub={s?.bill_budget ? "A bill" : "Set one below"}
      />
    </SummaryCard>
  );
}
