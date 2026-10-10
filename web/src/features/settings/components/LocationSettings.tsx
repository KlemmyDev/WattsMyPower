import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { locationLabel } from "~/features/common/energy/utils";
import { useLive } from "~/features/common/live/hooks/useLive";
import { siteZone } from "~/features/common/time/utils";
import { gridQuery } from "~/features/grid/api";
import { DaylightVisual } from "~/features/settings/components/DaylightVisual";
import { LocationForm } from "~/features/settings/components/LocationForm";
import { OptionList, OptionRow, SettingsSection, SettingsSplit } from "~/features/settings/components/SettingsSection";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

const coord = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(3)}° ${v < 0 ? neg : pos}`;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <OptionRow label={label}>
      <span className="text-right text-[15px] text-ink-muted tabular-nums">{children}</span>
    </OptionRow>
  );
}

/**
 * Settings → Location: where the system is, for the solar forecast, sunrise and sunset, and the grid's region. Its
 * daylight on the left (today's sun and the year's), the place and changing it on the right.
 */
export function LocationSettings() {
  const s = useLive()?.system;
  const region = useQuery(gridQuery).data?.region_name;
  const lat = s?.latitude ?? null;
  const lon = s?.longitude ?? null;
  const set = lat != null && lon != null && (lat !== 0 || lon !== 0);
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/settings">Settings</BackLink>}
        id="h-location-page"
        title="Location"
        sub="Where your system is. The solar forecast, sunrise and sunset, and the grid's region all follow it."
      />
      <SettingsSplit
        visual={
          <SettingsSection
            id="h-daylight"
            title="Daylight"
            sub={
              set ? `At ${locationLabel(s)}, worked out from where it is.` : "Set your location to see its daylight."
            }
          >
            {set ? (
              <DaylightVisual lat={lat} lon={lon} />
            ) : (
              <div className="rounded-2xl bg-canvas/60 px-4 py-6 text-center text-[13px] text-ink-muted light:bg-canvas">
                No location yet.
              </div>
            )}
          </SettingsSection>
        }
      >
        <SettingsSection id="h-location-place" title="Your location">
          <OptionList>
            <Fact label="Place">{set ? locationLabel(s) : "Not set"}</Fact>
            <Fact label="Coordinates">{set ? `${coord(lat, "N", "S")}, ${coord(lon, "E", "W")}` : "—"}</Fact>
            <Fact label="Time zone">{siteZone().replace(/_/g, " ")}</Fact>
            <Fact label="Grid region">{region ?? "—"}</Fact>
          </OptionList>
        </SettingsSection>
        <SettingsSection
          id="h-location-change"
          title="Change location"
          sub="Search for your suburb. Only its name and coordinates are kept, never a street address."
        >
          {/* Started afresh once the location is known, and again when it's changed. */}
          <LocationForm key={`${s?.latitude},${s?.longitude}`} system={s} autoFocus={false} className="pl-0" />
        </SettingsSection>
      </SettingsSplit>
    </>
  );
}
