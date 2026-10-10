import { useState, type FormEvent, type ReactNode } from "react";
import { useLive } from "~/features/common/live/hooks/useLive";
import type { SystemInfo } from "~/features/common/live/types";
import { useSaveSettings } from "~/features/common/settings/hooks";
import { OWNERSHIP_SETTINGS, type OwnershipKey, type Settings } from "~/features/common/settings/types";
import { saveSettingsError } from "~/features/common/settings/utils";
import { monthYear } from "~/features/common/formatting/utils/date";
import { dollars } from "~/features/common/formatting/utils/number";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Field, Input } from "~/features/common/ui/components/Field";
import { SummaryCard, SummaryStat } from "~/features/common/ui/components/Summary";
import { useToast } from "~/features/common/ui/components/Toast";
import { dateKey, fromDateKey } from "~/features/common/time/utils";
import { SaveBar, SettingsSection } from "~/features/settings/components/SettingsSection";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

type Values = Record<OwnershipKey, string>;

const DATES: OwnershipKey[] = ["system_installed", "battery_installed"];

/** Saved values as the form shows them: blank for "not set", dates as YYYY-MM-DD. */
const valuesOf = (s: Settings): Values =>
  Object.fromEntries(
    OWNERSHIP_SETTINGS.map((k) => [k, !s[k] ? "" : DATES.includes(k) ? dateKey(s[k]) : String(s[k])]),
  ) as Values;

/** A form value as saved: 0 for blank, local midnight for a date. NaN when it isn't a number. */
const saved = (k: OwnershipKey, v: string) => (v.trim() === "" ? 0 : DATES.includes(k) ? fromDateKey(v) : Number(v));

const NAMES: Record<OwnershipKey, string> = {
  system_cost: "what the system cost",
  system_installed: "when the system was installed",
  battery_installed: "when the battery was installed",
  battery_warranty_years: "the battery warranty's years",
  battery_warranty_mwh: "the battery warranty's energy",
};

const SYSTEM_KEYS: OwnershipKey[] = ["system_cost", "system_installed"];
const BATTERY_KEYS: OwnershipKey[] = ["battery_installed", "battery_warranty_years", "battery_warranty_mwh"];

/**
 * Settings → Cost and warranty: what the system cost and when it went in (for payback on Bills), and the
 * battery's warranty (for Battery). What's set at the top, then the system's and the battery's, each saved on its own.
 */
export function OwnershipSettings() {
  const s = useLive()?.system;
  const years = s?.battery_warranty_years;
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/settings">Settings</BackLink>}
        id="h-sys-own"
        title="Cost and warranty"
        sub="Optional. With these, Bills shows when the system pays for itself, and Battery how much of its warranty is used."
      />
      <SummaryCard icon="dollar" color={COLOR.good} label="Cost and warranty">
        <SummaryStat
          label="System cost"
          value={s?.system_cost ? dollars(s.system_cost) : "Not set"}
          sub="After rebates"
        />
        <SummaryStat
          label="Installed"
          value={s?.system_installed ? monthYear.format(new Date(s.system_installed * 1000)) : "Not set"}
          sub="For payback"
        />
        <SummaryStat
          label="Battery warranty"
          value={years ? `${years} years` : "Not set"}
          sub={
            years && (s?.battery_installed || s?.system_installed)
              ? `Until ${monthYear.format(warrantyEnd((s.battery_installed || s.system_installed)!, years))}`
              : "From the warranty"
          }
        />
        <SummaryStat
          label="Warranty energy"
          value={s?.battery_warranty_mwh ? `${s.battery_warranty_mwh} MWh` : "Not set"}
          sub="Throughput limit"
        />
      </SummaryCard>
      {/* Mounted once the status has loaded, so the fields start from the saved values. */}
      {s && (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
          <OwnershipForm
            system={s}
            keys={SYSTEM_KEYS}
            id="h-own-system"
            title="The system"
            sub="What it cost and when it went in, for when it pays for itself on Bills."
            saveLabel="Save"
            saved="Saved. Payback is updated."
          />
          <OwnershipForm
            system={s}
            keys={BATTERY_KEYS}
            id="h-own-battery"
            title="The battery"
            sub="Its warranty, for how much of it is used on Battery."
            saveLabel="Save"
            saved="Saved. The battery's warranty is updated."
          />
        </div>
      )}
    </>
  );
}

/** When a warranty of `years` from `from` (unix seconds) ends. */
function warrantyEnd(from: number, years: number) {
  const d = new Date(from * 1000);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

const LABELS: Record<OwnershipKey, [label: string, help: ReactNode, unit?: string]> = {
  system_cost: ["What the system cost", "After rebates."],
  system_installed: ["When it was installed", "Savings from before your readings start are estimated at today's rate."],
  battery_installed: ["When the battery was installed", "Only if it went in later than the panels."],
  battery_warranty_years: ["Warranty", "Years, from the warranty document (often 10).", "years"],
  battery_warranty_mwh: [
    "Warranty energy",
    "The energy it's guaranteed to deliver, if the warranty gives one (a throughput limit).",
    "MWh",
  ],
};

/** A section of the settings `keys`, saved together. */
function OwnershipForm({
  system: s,
  keys,
  id,
  title,
  sub,
  saveLabel,
  saved: savedToast,
}: {
  system: SystemInfo;
  keys: OwnershipKey[];
  id: string;
  title: string;
  sub: string;
  saveLabel: string;
  saved: string;
}) {
  const save = useSaveSettings();
  const toast = useToast();
  const [values, setValues] = useState(() => valuesOf(s));
  const [error, setError] = useState("");
  const changed = keys.filter((k) => saved(k, values[k]) !== (s[k] || 0));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const bad = changed.find((k) => Number.isNaN(saved(k, values[k])));
    if (bad) return setError(`Enter a number for ${NAMES[bad]}, or leave it blank.`);
    const changes: Partial<Settings> = Object.fromEntries(changed.map((k) => [k, saved(k, values[k])]));
    save.mutate(changes, {
      onSuccess: (next) => {
        setValues(valuesOf({ ...s, ...next }));
        toast(savedToast);
      },
      onError: (err) => setError(saveSettingsError(err)),
    });
  };

  return (
    <SettingsSection id={id} title={title} sub={sub} className="h-full">
      <form className="flex flex-1 flex-col gap-6" onSubmit={submit} noValidate>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] items-start gap-5">
          {keys.map((key) => {
            const [label, help, unit] = LABELS[key];
            return (
              <Field key={key} label={label} help={help}>
                <Input
                  type={DATES.includes(key) ? "date" : "number"}
                  inputMode={DATES.includes(key) ? undefined : "decimal"}
                  step={key === "system_cost" ? "1" : "0.1"}
                  min="0"
                  prefix={key === "system_cost" ? "$" : undefined}
                  unit={unit}
                  value={values[key]}
                  onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                />
              </Field>
            );
          })}
        </div>
        <div className="mt-auto">
          <SaveBar label={saveLabel} pending={save.isPending} disabled={!changed.length} error={error} />
        </div>
      </form>
    </SettingsSection>
  );
}
