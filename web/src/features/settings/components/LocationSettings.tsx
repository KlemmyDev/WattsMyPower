import { useQuery } from "@tanstack/react-query";
import { locationLabel } from "~/features/common/energy/utils";
import { useLive } from "~/features/common/live/hooks/useLive";
import { COLOR } from "~/features/common/theme/utils/colors";
import { SummaryCard, SummaryStat } from "~/features/common/ui/components/Summary";
import { gridQuery } from "~/features/grid/api";
import { LocationForm } from "~/features/settings/components/LocationForm";
import { SettingsSection } from "~/features/settings/components/SettingsSection";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

const coord = (v: number | null | undefined) => (v == null ? "—" : Number(v).toFixed(3));

/** Manage → System → Location: where the system is, for the solar forecast, sunrise and sunset, and the grid's region. */
export function LocationSettings() {
  const s = useLive()?.system;
  const region = useQuery(gridQuery).data?.region_name;
  const set = s?.latitude != null && (s.latitude !== 0 || s.longitude !== 0);
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/system">System</BackLink>}
        id="h-location-page"
        title="Location"
        sub="Where your system is. The solar forecast, sunrise and sunset, and the grid's region all follow it."
      />
      <SummaryCard icon="pin" color={COLOR.teal} label="Your location">
        <SummaryStat label="Location" value={set ? locationLabel(s) : "Not set"} sub="For the forecast" />
        <SummaryStat label="Latitude" value={set ? coord(s?.latitude) : "—"} />
        <SummaryStat label="Longitude" value={set ? coord(s?.longitude) : "—"} />
        <SummaryStat label="Grid region" value={region ?? "—"} sub="AEMO's prices, on Grid" />
      </SummaryCard>
      <SettingsSection
        id="h-location-change"
        title="Change location"
        sub="Search for your suburb. Only the suburb's name and its coordinates are kept, never a street address."
      >
        {/* Started afresh once the location is known, and again when it's changed. */}
        <LocationForm key={`${s?.latitude},${s?.longitude}`} system={s} autoFocus={false} className="pl-0" />
      </SettingsSection>
    </>
  );
}
