import { useState, type FormEvent, type ReactNode } from "react";
import type { SystemInfo } from "~/features/common/live/types";
import { hhmm } from "~/features/common/formatting/utils/date";
import { pct } from "~/features/common/formatting/utils/number";
import { useLive } from "~/features/common/live/hooks/useLive";
import { inverterName } from "~/features/common/live/utils";
import { useSaveSettings } from "~/features/common/settings/hooks";
import { SYSTEM_SETTINGS, type Settings, type SystemSettingKey } from "~/features/common/settings/types";
import { saveSettingsError } from "~/features/common/settings/utils";
import { Button, ButtonLink } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input } from "~/features/common/ui/components/Field";
import { cn } from "~/features/common/ui/utils";
import { useToast } from "~/features/common/ui/components/Toast";
import { CardTitle, SettingsCard } from "~/features/settings/components/SettingsCard";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

function secondInverter(pv2: NonNullable<SystemInfo["pv2"]>): string {
  const model = pv2.model
    ? `${inverterName(pv2)}${pv2.nominal_kw ? `, ${pv2.nominal_kw} kW` : ""}`
    : `At ${pv2.host}, not read yet`;
  return (
    model +
    (pv2.behind_meter ? ", behind the hybrid's meter" : ", outside the hybrid's meter (output counted as export)")
  );
}

const SECOND = "Second inverter";

function systemRows(s: SystemInfo | undefined): [string, string][] {
  return [
    ["Inverter", s?.model ? `${inverterName(s)} hybrid${s.nominal_kw ? `, ${s.nominal_kw} kW` : ""}` : "—"],
    ["Serial number", s?.serial || "—"],
    ["Solar array", s?.pv_kw ? `${s.pv_kw} kW` : "Not set"],
    ["Battery", s?.battery_kwh ? `${s.battery_kwh} kWh` : "—"],
    ["Backup reserve", s?.battery_reserve != null ? pct(s.battery_reserve) : "—"],
    ["Grid connection", s?.phases || "—"],
    ...(s?.pv2 ? [[SECOND, secondInverter(s.pv2)] satisfies [string, string]] : []),
  ];
}

/**
 * Manage → System → Solar and battery: what the inverters report about the installation, and the details they can't.
 */
export function SolarBatterySettings() {
  const live = useLive();
  const last = live?.last_success;
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/system">System</BackLink>}
        id="h-solar-battery"
        title="Solar and battery"
        sub="What your inverters report about your system, and the details they can't."
      />
      <SettingsCard aria-labelledby="h-sys">
        <div className="px-6 pt-5 pb-4 max-sm:px-5">
          <CardTitle
            id="h-sys"
            title="Your system"
            sub={`From your ${live?.system.brand ? `${live.system.brand} ` : ""}inverter over the local network · ${last ? `last read ${hhmm(last)}` : "not read yet"}`}
          />
        </div>
        {/* Tiles: 2, 3 or 6 across, which the six always fill; a second inverter, a longer line, gets a row of
            its own. Each draws its own lines on the right and below, and the edge ones are clipped. */}
        <div className="overflow-hidden border-y border-line-subtle">
          <dl className="m-0 -mr-px -mb-px grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
            {systemRows(live?.system).map(([label, value]) => (
              <div
                key={label}
                className={cn(
                  "flex min-w-0 flex-col gap-1 border-r border-b border-line-subtle px-6 py-4 max-sm:px-5",
                  label === SECOND && "col-span-full",
                )}
              >
                <dt className="text-xs text-ink-muted">{label}</dt>
                <dd className="m-0 text-[15px] font-medium break-words tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 max-sm:px-5">
          <span className="min-w-[200px] flex-1 text-[13px] leading-5 text-ink-muted">
            Inverters are added and connected in Integrations.
          </span>
          <ButtonLink to="/integrations/sungrow" variant="outline" size="sm">
            Manage inverters
          </ButtonLink>
        </div>
      </SettingsCard>
      {/* Mounted once the status has loaded, so the fields start from the saved values. */}
      {live && <SystemForm system={live.system} />}
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
    <SettingsCard padded aria-labelledby="h-sys-details">
      <CardTitle
        id="h-sys-details"
        title="Your system's details"
        sub="What your inverter can't tell us. Changes apply straight away across the app."
      />
      <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
        <SystemDetailsFields system={s} form={form} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={!form.changed.length || form.pending}>
            {form.pending ? "Saving…" : "Save details"}
          </Button>
          <HelpText tone="bad" role="alert">
            {form.error}
          </HelpText>
        </div>
      </form>
    </SettingsCard>
  );
}
