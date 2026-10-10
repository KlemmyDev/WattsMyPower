import { periodStart } from "~/features/bills/utils";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { useSaveSettings } from "~/features/common/settings/hooks";
import { saveSettingsError } from "~/features/common/settings/utils";
import { Field, HelpText, Select } from "~/features/common/ui/components/Field";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { COLOR } from "~/features/common/theme/utils/colors";
import { ChoiceTiles, SettingsSection } from "~/features/settings/components/SettingsSection";
import { dayMonth } from "~/features/common/formatting/utils/date";
import { addDays, nowS, partsOf, siteTime } from "~/features/common/time/utils";

const FREQUENCIES = [
  { value: "1", title: "Monthly", sub: "12 bills a year", icon: "calendar" as const },
  { value: "2", title: "Every 2 months", sub: "6 bills a year", icon: "calendar" as const },
  { value: "3", title: "Quarterly", sub: "4 bills a year", icon: "calendar" as const },
];

/** Bills → Rates & settings: how often bills come and when a period starts, so estimates line up with the retailer's. */
export function BillingSettings() {
  return (
    <SettingsSection
      id="period"
      className="scroll-mt-6"
      title="Billing period"
      sub="Match these to your bill so estimates line up with what your retailer charges. Saved as you choose."
    >
      <BillingFields rows />
    </SettingsSection>
  );
}

/**
 * The billing period's fields, saved as they change, without a card (the set-up guide shows them too). `rows`: how
 * often as rows, for a narrow column.
 */
export function BillingFields({ rows }: { rows?: boolean }) {
  const s = useSystem();
  const save = useSaveSettings();
  const pending = save.isPending ? save.variables : undefined;
  const months = pending?.bill_months ?? s?.bill_months ?? 3;
  const day = pending?.bill_day ?? s?.bill_day ?? 1;
  const anchor = pending?.bill_anchor ?? s?.bill_anchor ?? 1;

  const now = nowS();
  const today = partsOf(now);
  const start = periodStart(now, months, day, anchor);
  const from = partsOf(start);
  const next = siteTime(from.year, from.month + months, day);
  const last = addDays(next, -1);
  const length = Math.round((next - start) / 86_400);
  // When a bill covers more than a month, the dates alone don't say which month a period starts in.
  const base = today.month - (today.day < day ? 1 : 0);
  const starts = Array.from({ length: months }, (_, k) => siteTime(today.year, base - k, day)).reverse();

  return (
    <>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">How often you are billed</span>
        <ChoiceTiles
          label="How often you are billed"
          rows={rows}
          min="10rem"
          phone={3}
          color={COLOR.good}
          options={FREQUENCIES}
          value={String(months)}
          onChange={(v) => save.mutate({ bill_months: Number(v), bill_anchor: from.month })}
        />
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] items-start gap-5">
        <Field label="Day the period starts" help="Day of the month, from 1 to 28">
          <Select
            value={day}
            onChange={(e) => save.mutate({ bill_day: Number(e.target.value) })}
            className="text-base tabular-nums"
          >
            {Array.from({ length: 28 }, (_, k) => (
              <option key={k + 1} value={k + 1}>
                {k + 1}
              </option>
            ))}
          </Select>
        </Field>
        {months > 1 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold">Current period started on</span>
            <Segmented
              label="Current period started on"
              options={starts.map((d) => {
                const { month, year } = partsOf(d);
                return { value: String(month), label: `${dayMonth(d)} ${year}` };
              })}
              value={String(from.month)}
              onChange={(v) => save.mutate({ bill_anchor: Number(v) })}
              className="w-fit max-w-full max-sm:w-full"
              buttonClassName="tabular-nums max-sm:flex-1 max-sm:justify-center max-sm:px-2"
            />
            <span className="text-xs text-ink-muted">Check the dates at the top of your latest bill</span>
          </div>
        )}
      </div>
      <div className="rounded-2xl bg-canvas/60 px-5 py-4 text-sm leading-[22px] text-pretty text-ink-muted light:bg-canvas">
        Your current billing period is {dayMonth(start)} to {dayMonth(last)} ({length} days). The next one starts on{" "}
        {dayMonth(next)}. Bill estimates across the app use these dates.
      </div>
      {save.isError && <HelpText tone="bad">{saveSettingsError(save.error)}</HelpText>}
    </>
  );
}
