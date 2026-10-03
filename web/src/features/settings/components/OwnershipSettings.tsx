import { useState, type FormEvent, type ReactNode } from "react";
import type { SystemInfo } from "~/features/common/live/types";
import { useSaveSettings } from "~/features/common/settings/hooks";
import { OWNERSHIP_SETTINGS, type OwnershipKey, type Settings } from "~/features/common/settings/types";
import { saveSettingsError } from "~/features/common/settings/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input } from "~/features/common/ui/components/Field";
import { useToast } from "~/features/common/ui/components/Toast";
import { dateKey, fromDateKey } from "~/features/common/time/utils";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";

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

/** What the system cost and when it went in (for payback on Bills), and the battery's warranty (for Health). */
export function OwnershipSettings({ system: s }: { system: SystemInfo }) {
  const save = useSaveSettings();
  const toast = useToast();
  const [values, setValues] = useState(() => valuesOf(s));
  const [error, setError] = useState("");
  const changed = OWNERSHIP_SETTINGS.filter((k) => saved(k, values[k]) !== (s[k] || 0));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const bad = changed.find((k) => Number.isNaN(saved(k, values[k])));
    if (bad) return setError(`Enter a number for ${NAMES[bad]}, or leave it blank.`);
    const changes: Partial<Settings> = Object.fromEntries(changed.map((k) => [k, saved(k, values[k])]));
    save.mutate(changes, {
      onSuccess: (next) => {
        setValues(valuesOf({ ...s, ...next }));
        toast("Saved. Payback and the battery's warranty are updated.");
      },
      onError: (err) => setError(saveSettingsError(err)),
    });
  };

  const field = (key: OwnershipKey, label: string, help: ReactNode, unit?: string) => (
    <Field label={label} help={help}>
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

  return (
    <SettingsCard padded aria-labelledby="h-sys-own">
      <SettingsTitle
        id="h-sys-own"
        title="Cost and warranty"
        sub="Optional. With these, Bills shows when the system pays for itself, and Health how much of the battery's warranty is used."
      />
      <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] items-start gap-5">
          {field("system_cost", "What the system cost", "After rebates.")}
          {field(
            "system_installed",
            "When it was installed",
            "Savings from before your readings start are estimated at today's rate.",
          )}
          {field("battery_installed", "When the battery was installed", "Only if it went in later than the panels.")}
          {field(
            "battery_warranty_years",
            "Battery warranty",
            "Years, from the warranty document (often 10).",
            "years",
          )}
          {field(
            "battery_warranty_mwh",
            "Battery warranty energy",
            "The energy it's guaranteed to deliver, if the warranty gives one (a throughput limit).",
            "MWh",
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={!changed.length || save.isPending}>
            {save.isPending ? "Saving…" : "Save cost and warranty"}
          </Button>
          <HelpText tone="bad" role="alert">
            {error}
          </HelpText>
        </div>
      </form>
    </SettingsCard>
  );
}
