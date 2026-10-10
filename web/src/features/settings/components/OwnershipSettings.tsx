import { useState } from "react";
import { useLive } from "~/features/common/live/hooks/useLive";
import type { SystemInfo } from "~/features/common/live/types";
import { useSaveSettings } from "~/features/common/settings/hooks";
import { OWNERSHIP_SETTINGS, type OwnershipKey, type Settings } from "~/features/common/settings/types";
import { saveSettingsError } from "~/features/common/settings/utils";
import { useToast } from "~/features/common/ui/components/Toast";
import { dateKey, fromDateKey } from "~/features/common/time/utils";
import { CostVisual } from "~/features/settings/components/CostVisual";
import {
  NumberRow,
  OptionList,
  SaveBanner,
  SettingsSection,
  SettingsSplit,
} from "~/features/settings/components/SettingsSection";
import { SettingsPageHeader } from "~/features/settings/components/SubPageHeader";

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

const LABELS: Record<OwnershipKey, [label: string, help: string, unit?: string]> = {
  system_cost: ["What it cost", "After rebates."],
  system_installed: ["When it went in", "Savings from before your readings start are estimated."],
  battery_installed: ["When the battery went in", "Only if later than the panels."],
  battery_warranty_years: ["Warranty", "From the warranty document, often 10.", "years"],
  battery_warranty_mwh: ["Warranty energy", "The energy it's guaranteed to deliver, if it says.", "MWh"],
};

/**
 * Settings → Cost and warranty: what the system has paid back and its life so far on the left, as they'd be with what's
 * typed; on the right what it cost and when it went in (for payback on Bills) and the battery's warranty (for Battery).
 */
export function OwnershipSettings() {
  const s = useLive()?.system;
  return (
    <>
      <SettingsPageHeader
        title="Cost and warranty"
        sub="Optional. With these, Bills shows when the system pays for itself, and Battery how much of its warranty is used."
      />
      {/* Mounted once the status has loaded, so the fields start from the saved values. */}
      {s && <Ownership system={s} />}
    </>
  );
}

function Ownership({ system: s }: { system: SystemInfo }) {
  const save = useSaveSettings();
  const toast = useToast();
  const [values, setValues] = useState(() => valuesOf(s));
  const [error, setError] = useState("");
  const changed = OWNERSHIP_SETTINGS.filter((k) => saved(k, values[k]) !== (s[k] || 0));
  const num = (k: OwnershipKey) => {
    const v = saved(k, values[k]);
    return Number.isNaN(v) ? 0 : v;
  };

  const submit = () => {
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

  const row = (key: OwnershipKey) => {
    const [label, help, unit] = LABELS[key];
    return (
      <NumberRow
        key={key}
        label={label}
        help={help}
        unit={unit}
        prefix={key === "system_cost" ? "$" : undefined}
        step={key === "system_cost" ? "1" : "0.1"}
        type={DATES.includes(key) ? "date" : "number"}
        value={values[key]}
        onChange={(v) => setValues((x) => ({ ...x, [key]: v }))}
      />
    );
  };

  return (
    <SettingsSplit
      visual={
        <SettingsSection id="h-own-return" title="Return on your system" sub="What it has saved against the grid.">
          <CostVisual
            figures={{
              cost: num("system_cost"),
              installed: num("system_installed"),
              batteryInstalled: num("battery_installed"),
              warrantyYears: num("battery_warranty_years"),
              warrantyMwh: num("battery_warranty_mwh"),
            }}
          />
        </SettingsSection>
      }
    >
      <SettingsSection id="h-own-system" title="The system" sub="For when it pays for itself, on Bills.">
        <OptionList>{(["system_cost", "system_installed"] as OwnershipKey[]).map(row)}</OptionList>
      </SettingsSection>
      <SettingsSection id="h-own-battery" title="The battery" sub="For how much of its warranty is used, on Battery.">
        <OptionList>
          {(["battery_installed", "battery_warranty_years", "battery_warranty_mwh"] as OwnershipKey[]).map(row)}
        </OptionList>
        {/* Saves both sections' changes, at the foot of the last. */}
        <SaveBanner
          dirty={changed.length > 0}
          pending={save.isPending}
          error={error}
          onDiscard={() => {
            setValues(valuesOf(s));
            setError("");
          }}
          onSave={submit}
        />
      </SettingsSection>
    </SettingsSplit>
  );
}
