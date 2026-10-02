import { periodStart } from "~/features/bills/utils";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { useSaveSettings } from "~/features/common/settings/hooks";
import { saveSettingsError } from "~/features/common/settings/utils";
import { Field, HelpText, Select } from "~/features/common/ui/components/Field";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { cn } from "~/features/common/ui/utils";
import { dayMonth } from "~/features/common/formatting/utils/date";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";

const FREQUENCIES = [
  { value: "1", label: "Monthly" },
  { value: "2", label: "Every 2 months" },
  { value: "3", label: "Quarterly" },
];

const dm = (d: Date) => dayMonth(d.getTime() / 1000);

/** Settings → Billing: how often bills come and when a period starts, so estimates line up with the retailer's. */
export function BillingSettings() {
  const s = useSystem();
  const save = useSaveSettings();
  const pending = save.isPending ? save.variables : undefined;
  const months = pending?.bill_months ?? s?.bill_months ?? 3;
  const day = pending?.bill_day ?? s?.bill_day ?? 1;
  const anchor = pending?.bill_anchor ?? s?.bill_anchor ?? 1;

  const today = new Date();
  const start = periodStart(today, months, day, anchor);
  const next = new Date(start.getFullYear(), start.getMonth() + months, day);
  const last = new Date(next.getFullYear(), next.getMonth(), next.getDate() - 1);
  const length = Math.round((next.getTime() - start.getTime()) / 86_400_000);
  // When a bill covers more than a month, the dates alone don't say which month a period starts in.
  const base = today.getMonth() - (today.getDate() < day ? 1 : 0);
  const starts = Array.from({ length: months }, (_, k) => new Date(today.getFullYear(), base - k, day)).reverse();

  return (
    <SettingsCard padded aria-labelledby="h-billing">
      <SettingsTitle
        id="h-billing"
        title="Billing period"
        sub="Match these to your electricity bill so estimates line up with what your retailer charges."
      />
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">How often you are billed</span>
        <Segmented
          label="How often you are billed"
          options={FREQUENCIES}
          value={String(months)}
          onChange={(v) => save.mutate({ bill_months: Number(v), bill_anchor: start.getMonth() + 1 })}
          className="grid max-w-[520px] grid-cols-3"
          buttonClassName="justify-center px-3.5 py-2.5"
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
            <div className="flex flex-wrap gap-2">
              {starts.map((d) => {
                const on = d.getMonth() === start.getMonth();
                return (
                  <button
                    key={d.getTime()}
                    type="button"
                    aria-pressed={on}
                    onClick={() => save.mutate({ bill_anchor: d.getMonth() + 1 })}
                    className={cn(
                      "h-11 rounded-full border px-[18px] text-sm font-semibold tabular-nums transition-colors",
                      on
                        ? "border-ink bg-ink text-ink-inverse"
                        : "border-line bg-transparent text-ink-muted hover:text-ink",
                    )}
                  >
                    {dm(d)} {d.getFullYear()}
                  </button>
                );
              })}
            </div>
            <span className="text-xs text-ink-muted">Check the dates at the top of your latest bill</span>
          </div>
        )}
      </div>
      <div className="rounded-xl bg-canvas px-[18px] py-4 text-sm leading-[22px] text-pretty text-ink-muted">
        Your current billing period is {dm(start)} to {dm(last)} ({length} days). The next one starts on {dm(next)}.
        Bill estimates across the app use these dates.
      </div>
      {save.isError && <HelpText tone="bad">{saveSettingsError(save.error)}</HelpText>}
    </SettingsCard>
  );
}
