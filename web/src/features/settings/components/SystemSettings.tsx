import type { SystemInfo } from "~/features/common/live/types";
import { SettingRow } from "~/features/common/ui/components/DataRow";
import { hhmm } from "~/features/common/formatting/utils/date";
import { pct } from "~/features/common/formatting/utils/number";
import { useLive } from "~/features/common/live/hooks/useLive";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";

function secondInverter(pv2: NonNullable<SystemInfo["pv2"]>): string {
  const model = pv2.model
    ? `Sungrow ${pv2.model}${pv2.nominal_kw ? `, ${pv2.nominal_kw} kW` : ""}`
    : `At ${pv2.host}, not read yet`;
  return (
    model +
    (pv2.behind_meter ? ", behind the hybrid's meter" : ", outside the hybrid's meter (output counted as export)")
  );
}

function systemRows(s: SystemInfo | undefined): [string, string][] {
  return [
    ["Site name", "Home"],
    ["Inverter", s?.model ? `Sungrow ${s.model} hybrid${s.nominal_kw ? `, ${s.nominal_kw} kW` : ""}` : "—"],
    ["Serial number", s?.serial || "—"],
    ["Solar array", s?.pv_kw ? `${s.pv_kw} kW` : "—"],
    ["Battery", s?.battery_kwh ? `${s.battery_kwh} kWh` : "—"],
    ["Maximum charge and discharge rate", s?.battery_max_kw ? `${s.battery_max_kw} kW` : "—"],
    ["Backup reserve", s?.battery_reserve != null ? pct(s.battery_reserve) : "—"],
    ["Grid connection", s?.phases || "—"],
    ...(s?.pv2 ? [["Second inverter", secondInverter(s.pv2)] satisfies [string, string]] : []),
  ];
}

/** Settings → System: what the inverters report about the installation. */
export function SystemSettings() {
  const live = useLive();
  const last = live?.last_success;
  return (
    <SettingsCard aria-labelledby="h-sys">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line-subtle p-6">
        <SettingsTitle
          id="h-sys"
          title="Solar and battery system"
          sub={`From your Sungrow inverter · ${last ? `last synced ${hhmm(last)}` : "not synced yet"}`}
        />
      </div>
      <div>
        {systemRows(live?.system).map(([label, value]) => (
          <SettingRow key={label} label={label}>
            {value}
          </SettingRow>
        ))}
      </div>
      <div className="px-6 py-4 text-[13px] leading-5 text-ink-muted">
        These details come from your inverters over the local network. Solar array size (PV_KW) and the second
        inverter's address (PV2_HOST) are set in the server configuration.
      </div>
    </SettingsCard>
  );
}
