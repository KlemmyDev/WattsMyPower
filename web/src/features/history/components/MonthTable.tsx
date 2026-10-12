import { DASH, kWhInt, money, pct } from "~/features/common/formatting/utils/number";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import type { Month } from "~/features/history/utils/year";

/** Each month with readings in figures, a row each: made, used, bought, self-sufficiency and saved. Choosing a month opens its days. */
export function MonthTable({
  months,
  onSelect,
  className,
}: {
  months: Month[];
  onSelect: (m: Month) => void;
  className?: string;
}) {
  if (!months.length) return null;
  return (
    <Card aria-labelledby="h-months" className={className}>
      <TitleBlock id="h-months" title="Month by month" sub="Select a month to see its days" />
      <table className="w-full border-collapse text-[13px] tabular-nums">
        <thead>
          <tr className="text-xs text-ink-muted">
            <th className="pb-2 text-left font-normal">Month</th>
            <th className="pb-2 text-right font-normal max-xs:hidden">Made</th>
            <th className="pb-2 text-right font-normal">Used</th>
            <th className="pb-2 text-right font-normal">Bought</th>
            <th className="pb-2 text-right font-normal">
              <span className="max-sm:hidden">Self-sufficiency</span>
              <span className="sm:hidden">Self-suff.</span>
            </th>
            <th className="pb-2 text-right font-normal">Saved</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr
              key={m.key}
              onClick={() => onSelect(m)}
              className="cursor-pointer border-t border-line-subtle transition-colors duration-200 hover:bg-fg/4"
            >
              <td className="py-2.5 text-left">
                <button
                  type="button"
                  aria-label={`${m.name} ${m.year}: show its days`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(m);
                  }}
                  className="border-0 bg-transparent p-0 text-ink hover:underline"
                >
                  {m.short}
                </button>
              </td>
              <td className="py-2.5 text-right text-ink-soft max-xs:hidden">{kWhInt(m.gen)}</td>
              <td className="py-2.5 text-right text-ink-soft">{kWhInt(m.home)}</td>
              <td className="py-2.5 text-right text-ink-soft">{kWhInt(m.imp)}</td>
              <td className="py-2.5 text-right text-ink-soft">
                {m.home > 0 ? pct(((m.direct + m.battery) / m.home) * 100) : DASH}
              </td>
              <td className="py-2.5 text-right text-ink">{money(m.saved)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
