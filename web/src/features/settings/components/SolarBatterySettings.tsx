import { useState, type FormEvent, type ReactNode } from "react";
import type { SystemInfo } from "~/features/common/live/types";
import { hhmm } from "~/features/common/formatting/utils/date";
import { pct } from "~/features/common/formatting/utils/number";
import { useLive } from "~/features/common/live/hooks/useLive";
import { useSaveSettings } from "~/features/common/settings/hooks";
import { SYSTEM_SETTINGS, type Settings, type SystemSettingKey } from "~/features/common/settings/types";
import { saveSettingsError } from "~/features/common/settings/utils";
import { COLOR } from "~/features/common/theme/utils/colors";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Field, Input } from "~/features/common/ui/components/Field";
import { SummaryCard, SummaryStat } from "~/features/common/ui/components/Summary";
import { useToast } from "~/features/common/ui/components/Toast";
import { SaveBar, SettingsSection } from "~/features/settings/components/SettingsSection";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

/**
 * Settings → Solar and battery: what the inverters report about the installation at the top, then the details
 * they can't.
 */
export function SolarBatterySettings() {
  const live = useLive();
  const s = live?.system;
  const last = live?.last_success;
  const overridden = !!s?.battery_kwh_override;
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/settings">Settings</BackLink>}
        id="h-solar-battery"
        title="Solar and battery"
        sub="What your inverters report about your system, and the details they can't."
      />
      <SummaryCard
        icon="sun"
        color={COLOR.solar}
        label="Your system"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-4 text-[13px] text-ink-muted">
            <span className="min-w-0 flex-1">
              {last ? `Read from your inverter at ${hhmm(last)}` : "Not read from your inverter yet"}
              {s?.serial && <span className="text-ink-faint"> · Serial {s.serial}</span>}
            </span>
            <ButtonLink to="/integrations/sungrow" variant="outline" size="sm">
              Manage inverters
            </ButtonLink>
          </div>
        }
      >
        <SummaryStat
          label="Inverter"
          value={s?.model ?? "—"}
          sub={[s?.brand, "hybrid", s?.nominal_kw && `${s.nominal_kw} kW`].filter(Boolean).join(" · ")}
        />
        <SummaryStat label="Solar array" value={s?.pv_kw ? `${s.pv_kw} kW` : "Not set"} sub="All your panels" />
        <SummaryStat
          label="Battery"
          value={s?.battery_kwh ? `${s.battery_kwh} kWh` : "—"}
          sub={overridden ? "Set by you" : "From the inverter"}
        />
        <SummaryStat
          label="Backup reserve"
          value={s?.battery_reserve != null ? pct(s.battery_reserve) : "—"}
          sub={s?.inverter_reserve != null ? "From the inverter" : "Set by you"}
        />
        <SummaryStat label="Grid" value={s?.phases ?? "—"} sub="Connection" />
        {s?.pv2 && (
          <SummaryStat
            label="Second inverter"
            value={s.pv2.model ?? "Not read yet"}
            sub={s.pv2.behind_meter ? "Behind the hybrid's meter" : "Counted as export"}
            title={
              s.pv2.behind_meter
                ? "Behind the hybrid's meter"
                : "Outside the hybrid's meter: its output is counted as export"
            }
          />
        )}
      </SummaryCard>
      {/* Mounted once the status has loaded, so the fields start from the saved values. */}
      {s && <SystemForm system={s} />}
    </>
  );
}

type Values = Record<SystemSettingKey, string>;

const valuesOf = (s: SystemInfo): Values => ({
  pv_kw: String(s.pv_kw),
  battery_kwh_override: String(s.battery_kwh_override),
  battery_reserve_fallback: String(s.battery_reserve_fallback),
  battery_max_kw: String(s.battery_max_kw),
});

const NAMES: Record<SystemSettingKey, string> = {
  pv_kw: "the solar array size",
  battery_kwh_override: "the battery capacity",
  battery_reserve_fallback: "the backup reserve",
  battery_max_kw: "the maximum charge and discharge rate",
};

/**
 * The details form's values, and saving them. `blank` starts those fields empty rather than at the value in
 * use, for the set-up guide: the array size there is only a default (6.6 kW) until someone enters theirs.
 */
export function useSystemDetails(s: SystemInfo, blank: SystemSettingKey[] = []) {
  const save = useSaveSettings();
  const [values, setValues] = useState(() => ({ ...valuesOf(s), ...Object.fromEntries(blank.map((k) => [k, ""])) }));
  const [error, setError] = useState("");
  // Blank counts as changed, so saving says what's missing.
  const changed = SYSTEM_SETTINGS.filter((k) => values[k].trim() === "" || Number(values[k]) !== s[k]);

  /** Save what changed; `onSaved` runs once it's stored (straight away if nothing changed). */
  const submit = (onSaved: (next: Partial<Settings>) => void) => {
    setError("");
    const empty = changed.find((k) => values[k].trim() === "" || Number.isNaN(Number(values[k])));
    if (empty) return setError(`Enter a number for ${NAMES[empty]}.`);
    if (!changed.length) return onSaved({});
    const changes: Partial<Settings> = Object.fromEntries(changed.map((k) => [k, Number(values[k])]));
    save.mutate(changes, {
      onSuccess: (next) => {
        setValues(valuesOf({ ...s, ...next }));
        onSaved(next);
      },
      onError: (err) => setError(saveSettingsError(err)),
    });
  };

  const set = (key: SystemSettingKey, value: string) => setValues((v) => ({ ...v, [key]: value }));
  return { values, set, changed, submit, error, pending: save.isPending };
}

export type SystemDetails = ReturnType<typeof useSystemDetails>;

/** The array size, battery capacity, backup reserve and battery rate, with what the inverter reports where it does. */
export function SystemDetailsFields({ system: s, form }: { system: SystemInfo; form: SystemDetails }) {
  const field = (
    key: SystemSettingKey,
    label: string,
    unit: string,
    step: string,
    help: ReactNode,
    placeholder?: string,
  ) => (
    <Field label={label} help={help}>
      <Input
        type="number"
        inputMode="decimal"
        step={step}
        unit={unit}
        placeholder={placeholder}
        value={form.values[key]}
        onChange={(e) => form.set(key, e.target.value)}
      />
    </Field>
  );

  const reportedKwh = s.inverter_battery_kwh;
  const reportedReserve = s.inverter_reserve;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] items-start gap-5">
      {field(
        "pv_kw",
        "Solar array size",
        "kW",
        "0.01",
        "The total of all your panels, on every inverter (not the inverter's size). The forecast starts from this, then learns from what your panels actually make.",
        "e.g. 13.2",
      )}
      {field(
        "battery_kwh_override",
        "Battery capacity",
        "kWh",
        "0.1",
        reportedKwh
          ? `Leave at 0 to use what your inverter reports (${reportedKwh} kWh). Set it only if that's wrong.`
          : "Leave at 0 to use what your inverter reports. Set it if your inverter doesn't report one.",
      )}
      {field(
        "battery_reserve_fallback",
        "Backup reserve",
        "%",
        "1",
        reportedReserve != null
          ? `The charge kept for blackouts. Your inverter reports ${pct(reportedReserve)}, so that's used instead of this.`
          : "The charge kept for blackouts. Used because your inverter doesn't report its own.",
      )}
      {field(
        "battery_max_kw",
        "Maximum charge and discharge rate",
        "kW",
        "0.1",
        "How fast the battery can charge or discharge. The forecast uses it to work out when the battery fills and empties.",
      )}
    </div>
  );
}

/** The details the inverter can't report, or that override what it does. */
function SystemForm({ system: s }: { system: SystemInfo }) {
  const toast = useToast();
  const form = useSystemDetails(s);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    form.submit(() => toast("System details saved. Updating the forecast."));
  };

  return (
    <SettingsSection
      id="h-sys-details"
      title="Details your inverter can't tell us"
      sub="Changes apply straight away across the dashboard, and the forecast updates."
    >
      <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
        <SystemDetailsFields system={s} form={form} />
        <SaveBar label="Save details" pending={form.pending} disabled={!form.changed.length} error={form.error} />
      </form>
    </SettingsSection>
  );
}
