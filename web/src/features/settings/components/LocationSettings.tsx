import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";
import { WeatherLocation } from "~/features/weather/components/WeatherSettings";

/** Manage → System → Location: where the system is, for the solar forecast, sunrise and sunset, and the grid's region. */
export function LocationSettings() {
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/system">System</BackLink>}
        id="h-location-page"
        title="Location"
        sub="Where your system is. The solar forecast, sunrise and sunset, and the grid's region all follow it."
      />
      <WeatherLocation />
    </>
  );
}
