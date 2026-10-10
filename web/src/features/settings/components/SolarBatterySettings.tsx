import { useState, type ReactNode } from "react";
import type { SystemInfo } from "~/features/common/live/types";
import { hhmm } from "~/features/common/formatting/utils/date";
import { pct } from "~/features/common/formatting/utils/number";
import { useLive } from "~/features/common/live/hooks/useLive";
import { useSaveSettings } from "~/features/common/settings/hooks";
import { SYSTEM_SETTINGS, type Settings, type SystemSettingKey } from "~/features/common/settings/types";
import { saveSettingsError } from "~/features/common/settings/utils";
import { inverterName } from "~/features/common/live/utils";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Field, Input } from "~/features/common/ui/components/Field";
import { useToast } from "~/features/common/ui/components/Toast";
import {
  NumberRow,
  OptionList,
  OptionRow,
  SaveBanner,
  SettingsSection,
  SettingsSplit,
} from "~/features/settings/components/SettingsSection";
import { SystemDiagram, type DiagramFigures } from "~/features/settings/components/SystemDiagram";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

/**
 * Settings → Solar and battery: the installation as a diagram on the left (figures not saved yet drawn as they'd be),
 * and on the right what the inverters report and the details they can't, saved together.
 */
export function SolarBatterySettings() {
  const live = useLive();
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/settings">Settings</BackLink>}
        id="h-solar-battery"
        title="Solar and battery"
        sub="What your inverters report about your system, and the details they can't."
      />
      {/* Mounted once the status has loaded, so the fields start from the saved values. */}
      {live && <SolarBattery system={live.system} last={live.last_success} />}
    </>
  );
}

/** A read-only fact in an OptionList: what it is, and its value on the right. */
function Fact({ label, help, children }: { label: string; help?: ReactNode; children: ReactNode }) {
  return (
    <OptionRow label={label} help={help}>
      <span className="max-w-[16rem] text-right text-[15px] break-words text-ink-muted tabular-nums">{children}</span>
    </OptionRow>
  );
}

function SolarBattery({ system: s, last }: { system: SystemInfo; last: number | null }) {
  const toast = useToast();
  const form = useSystemDetails(s);
  const v = (k: SystemSettingKey) => (form.values[k].trim() === "" ? null : Number(form.values[k]) || null);
  const override = v("battery_kwh_override");
  const figures: DiagramFigures = {
    pvKw: v("pv_kw") ?? s.pv_kw,
    batteryKwh: override ?? s.inverter_battery_kwh ?? null,
    reservePct: s.inverter_reserve ?? v("battery_reserve_fallback"),
    maxKw: v("battery_max_kw"),
  };
  const reportedKwh = s.inverter_battery_kwh;
  const reportedReserve = s.inverter_reserve;
  const row = (key: SystemSettingKey, label: string, help: ReactNode, unit: string, step: string) => (
    <NumberRow
      label={label}
      help={help}
      unit={unit}
      step={step}
      value={form.values[key]}
      onChange={(value) => form.set(key, value)}
    />
  );

  return (
    <SettingsSplit
      visual={
        <SettingsSection
          id="h-diagram"
          title="Your system"
          sub={last ? `Read from your inverter at ${hhmm(last)}.` : "Not read from your inverter yet."}
          aside={
            <ButtonLink to="/integrations/sungrow" variant="outline" size="sm">
              Manage inverters
            </ButtonLink>
          }
        >
          <SystemDiagram system={s} figures={figures} />
        </SettingsSection>
      }
    >
      <SettingsSection
        id="h-sys-details"
        title="Details"
        sub="What your inverter can't tell us. The forecast and bills use them as soon as they're saved."
      >
        <OptionList>
          {row(
            "pv_kw",
            "Solar array size",
            "All your panels, on every inverter. The forecast starts from it, then learns.",
            "kW",
            "0.01",
          )}
          {row(
            "battery_kwh_override",
            "Battery capacity",
            reportedKwh
              ? `0 uses what your inverter reports (${reportedKwh} kWh). Set it only if that's wrong.`
              : "Your inverter doesn't report one, so set it here.",
            "kWh",
            "0.1",
          )}
          {row(
            "battery_reserve_fallback",
            "Backup reserve",
            reportedReserve != null
              ? `Your inverter reports ${pct(reportedReserve)}, which is used instead.`
              : "The charge kept for blackouts.",
            "%",
            "1",
          )}
          {row(
            "battery_max_kw",
            "Charge and discharge rate",
            "How fast the battery fills and empties, for the forecast.",
            "kW",
            "0.1",
          )}
        </OptionList>
        <SaveBanner
          dirty={form.changed.length > 0}
          pending={form.pending}
          error={form.error}
          onDiscard={form.reset}
          onSave={() => form.submit(() => toast("System details saved. Updating the forecast."))}
        />
      </SettingsSection>
      <SettingsSection id="h-equipment" title="From your inverter" sub="Read over your local network.">
        <OptionList>
          <Fact label="Inverter">
            {s.model ? `${inverterName(s)}${s.nominal_kw ? `, ${s.nominal_kw} kW` : ""}` : "—"}
          </Fact>
          <Fact label="Serial number">{s.serial || "—"}</Fact>
          <Fact label="Battery">{reportedKwh ? `${reportedKwh} kWh` : "Not reported"}</Fact>
          <Fact label="Backup reserve">{reportedReserve != null ? pct(reportedReserve) : "Not reported"}</Fact>
          <Fact label="Grid connection">{s.phases || "—"}</Fact>
          {s.pv2 && (
            <Fact
              label="Second inverter"
              help={
                s.pv2.behind_meter
                  ? "Behind the hybrid's meter."
                  : "Outside the hybrid's meter, so its output counts as export."
              }
            >
              {s.pv2.model
                ? `${inverterName(s.pv2)}${s.pv2.nominal_kw ? `, ${s.pv2.nominal_kw} kW` : ""}`
                : "Not read yet"}
            </Fact>
          )}
        </OptionList>
      </SettingsSection>
    </SettingsSplit>
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
  /** Back to what's saved. */
  const reset = () => {
    setValues(valuesOf(s));
    setError("");
  };
  return { values, set, reset, changed, submit, error, pending: save.isPending };
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
