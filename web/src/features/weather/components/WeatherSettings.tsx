import { locationLabel } from "~/features/common/energy/utils";
import { useLive } from "~/features/common/live/hooks/useLive";
import { LocationForm } from "~/features/settings/components/LocationForm";
import { SettingsCard } from "~/features/settings/components/SettingsCard";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

/** Where the forecast is for, and changing it. */
export function WeatherLocation() {
  const system = useLive()?.system;
  return (
    <SettingsCard padded aria-labelledby="h-location" className="gap-4">
      <div className="flex flex-col gap-1">
        <h3 id="h-location" className="text-[15px] font-semibold">
          Location
        </h3>
        <span className="text-sm text-ink-muted">
          The forecast is for <b className="font-semibold text-ink">{locationLabel(system)}</b>. Search for a suburb to
          change it.
        </span>
      </div>
      {/* Started afresh once the location is known, and again when it's changed. */}
      <LocationForm
        key={`${system?.latitude},${system?.longitude}`}
        system={system}
        autoFocus={false}
        className="pl-0"
      />
    </SettingsCard>
  );
}

/** Settings → Integrations → Weather: the Open-Meteo forecast behind the solar forecast. */
export function WeatherSettings() {
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/settings/integrations">Integrations</BackLink>}
        id="h-weather"
        title="Weather"
        sub="Hourly cloud cover and temperature from Open-Meteo, for the solar forecast"
      />
      <WeatherLocation />
    </>
  );
}
