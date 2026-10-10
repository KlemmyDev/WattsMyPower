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
import { useToast } from "~/features/common/ui/components/Toast";
import { cn } from "~/features/common/ui/utils";
import {
  NumberRow,
  OptionList,
  SaveBanner,
  SettingsSection,
  SettingsSplit,
} from "~/features/settings/components/SettingsSection";
import { SystemDiagram, type DiagramFigures } from "~/features/settings/components/SystemDiagram";
import { SettingsPageHeader } from "~/features/settings/components/SubPageHeader";

/**
 * Settings → Solar and battery: the installation as a diagram on the left (figures not saved yet drawn as they'd be)
 * with what the inverter reports under it, and on the right the details it can't, saved together.
 */
export function SolarBatterySettings() {
  const live = useLive();
  return (
    <>
      <SettingsPageHeader
        title="Solar and battery"
        sub="What your inverters report about your system, and the details they can't."
      />
      {/* Mounted once the status has loaded, so the fields start from the saved values. */}
      {live && <SolarBattery system={live.system} last={live.last_success} />}
    </>
  );
}

/** A read-only figure from the inverter, under the diagram: what it is, and its value. */
function Fact({
  label,
  title,
  wide,
  children,
}: {
  label: string;
  title?: string;
  /** Two columns across, for a name. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div title={title} className={cn("flex min-w-0 flex-col gap-0.5", wide && "col-span-2")}>
      <dt className="truncate text-xs text-ink-muted">{label}</dt>
      <dd className="truncate text-sm text-ink tabular-nums">{children}</dd>
    </div>
  );
}

function SolarBattery({ system: s, last }: { system: SystemInfo; last: number | null }) {
  const toast = useToast();
  const form = useSystemDetails(s);
  const reportedKwh = s.inverter_battery_kwh;
  const reportedReserve = s.inverter_reserve;

  return (
    <SettingsSplit
      visual={
        <SettingsSection
          id="h-diagram"
          title="Your system"
          sub={last ? `Read from your inverter at ${hhmm(last)}.` : "Not read from your inverter yet."}
          aside={
            <ButtonLink to="/integrations/inverters" variant="outline" size="sm">
              Manage inverters
            </ButtonLink>
          }
        >
          <SystemDiagram system={s} figures={diagramFigures(s, form)} />
          <dl
            aria-label="From your inverter"
            className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-x-5 gap-y-3 rounded-2xl bg-canvas/60 px-4 py-3.5 light:bg-canvas"
          >
            <Fact label="Inverter" title={inverterLine(s)} wide>
              {inverterLine(s)}
            </Fact>
            <Fact label="Serial number">{s.serial || "—"}</Fact>
            <Fact label="Battery reported">{reportedKwh ? `${reportedKwh} kWh` : "Not reported"}</Fact>
            <Fact label="Reserve reported">{reportedReserve != null ? pct(reportedReserve) : "Not reported"}</Fact>
            <Fact label="Grid connection">{s.phases || "—"}</Fact>
            {s.pv2 && (
              <Fact
                label="Second inverter"
                wide
                title={
                  s.pv2.behind_meter
                    ? "Behind the hybrid's meter."
                    : "Outside the hybrid's meter, so its output counts as export."
                }
              >
                {s.pv2.model ? inverterLine(s.pv2) : "Not read yet"}
              </Fact>
            )}
          </dl>
        </SettingsSection>
      }
    >
      <SettingsSection
        id="h-sys-details"
        title="Details"
        sub="What your inverter can't tell us. The forecast and bills use them as soon as they're saved."
      >
        <SystemDetailRows system={s} form={form} />
        <SaveBanner
          dirty={form.changed.length > 0}
          pending={form.pending}
          error={form.error}
          onDiscard={form.reset}
          onSave={() => form.submit(() => toast("System details saved. Updating the forecast."))}
        />
      </SettingsSection>
    </SettingsSplit>
  );
}

/** "Sungrow SH5.0RS, 5 kW", or a dash before it's been read. */
const inverterLine = (i: { brand?: string | null; model?: string | null; nominal_kw?: number | null }) =>
  i.model ? `${inverterName(i)}${i.nominal_kw ? `, ${i.nominal_kw} kW` : ""}` : "—";

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

/** A typed figure, or null while it's blank (or not a number above 0). */
const typed = (form: SystemDetails, k: SystemSettingKey) =>
  form.values[k].trim() === "" ? null : Number(form.values[k]) || null;

/** What the diagram draws: the figures as typed, not saved yet, else the system's own. */
export function diagramFigures(s: SystemInfo, form: SystemDetails): DiagramFigures {
  return {
    pvKw: typed(form, "pv_kw") ?? s.pv_kw,
    batteryKwh: typed(form, "battery_kwh_override") ?? s.inverter_battery_kwh ?? null,
    reservePct: s.inverter_reserve ?? typed(form, "battery_reserve_fallback"),
    maxKw: typed(form, "battery_max_kw"),
  };
}

/**
 * The array size, battery capacity, backup reserve and battery rate as rows in a sunken panel, each with what the
 * inverter reports where it does.
 */
export function SystemDetailRows({ system: s, form }: { system: SystemInfo; form: SystemDetails }) {
  const reportedKwh = s.inverter_battery_kwh;
  const reportedReserve = s.inverter_reserve;
  const row = (
    key: SystemSettingKey,
    label: string,
    help: ReactNode,
    unit: string,
    step: string,
    placeholder?: string,
  ) => (
    <NumberRow
      label={label}
      help={help}
      unit={unit}
      step={step}
      placeholder={placeholder}
      value={form.values[key]}
      onChange={(value) => form.set(key, value)}
    />
  );
  return (
    <OptionList>
      {row(
        "pv_kw",
        "Solar array size",
        "All your panels, on every inverter. The forecast starts from it, then learns.",
        "kW",
        "0.01",
        "e.g. 13.2",
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
  );
}
