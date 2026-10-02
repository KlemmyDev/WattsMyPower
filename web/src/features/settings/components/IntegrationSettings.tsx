import { useState } from "react";
import { Button } from "~/features/common/ui/components/Button";
import { locationLabel } from "~/features/common/energy/utils";
import { useForecast } from "~/features/common/weather/hooks";
import { useLive } from "~/features/common/live/hooks/useLive";
import { InverterSettings } from "~/features/integrations/components/InverterSettings";
import { IntegrationRow } from "~/features/settings/components/IntegrationRow";
import { LocationForm } from "~/features/settings/components/LocationForm";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";

/** Settings → Integrations: the inverters and the weather forecast (with the location form), then what's coming. */
export function IntegrationSettings() {
  const live = useLive();
  const forecast = useForecast();
  const [locationOpen, setLocationOpen] = useState(false);
  const forecastOk = !!forecast;

  return (
    <>
      <InverterSettings />
      <SettingsCard aria-label="Connected services">
        <IntegrationRow
          icon="cloudSun"
          name="Weather forecast"
          on={forecastOk}
          status={forecastOk ? "Connected" : forecast === undefined ? "Checking" : "Unavailable"}
          detail={`Hourly cloud cover and temperature from Open-Meteo for ${locationLabel(live?.system)}`}
          action={
            <Button variant="outline" onClick={() => setLocationOpen((o) => !o)}>
              Change location
            </Button>
          }
        >
          {locationOpen && <LocationForm system={live?.system} onClose={() => setLocationOpen(false)} />}
        </IntegrationRow>
      </SettingsCard>

      <section aria-labelledby="h-soon" className="flex max-w-[880px] flex-col gap-3 pt-3">
        <SettingsTitle id="h-soon" title="Coming soon" sub="Integrations being worked on." />
        <SettingsCard>
          <IntegrationRow
            icon="car"
            name="Tesla"
            on={false}
            status="Coming soon"
            detail="Charge your car with excess solar while keeping enough for the home battery"
          />
        </SettingsCard>
      </section>
    </>
  );
}
