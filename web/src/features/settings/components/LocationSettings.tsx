import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { locationLabel } from "~/features/common/energy/utils";
import { useLive } from "~/features/common/live/hooks/useLive";
import { useSaveSettings } from "~/features/common/settings/hooks";
import { saveSettingsError } from "~/features/common/settings/utils";
import { Input, Select } from "~/features/common/ui/components/Field";
import { useToast } from "~/features/common/ui/components/Toast";
import { gridQuery } from "~/features/grid/api";
import { DaylightVisual } from "~/features/settings/components/DaylightVisual";
import { LocationForm } from "~/features/settings/components/LocationForm";
import { OptionList, OptionRow, SettingsSection, SettingsSplit } from "~/features/settings/components/SettingsSection";
import { SettingsPageHeader } from "~/features/settings/components/SubPageHeader";

const zoneLabel = (tz: string) => tz.replace(/_/g, " ");

/** Old names for zones that browsers still list alongside the current ones (Asia/Calcutta is Asia/Kolkata now). */
// prettier-ignore
const LEGACY = new Set([
  "Africa/Asmera", "Africa/Dar_es_Salaam", "America/Godthab", "Asia/Calcutta", "Asia/Rangoon", "Asia/Saigon",
  "Europe/Kiev", "Pacific/Ponape", "Pacific/Truk",
]);

/** The time zones the browser knows, Australia's first, without the old names. */
const ZONES = (() => {
  let all: string[] = [];
  try {
    all = Intl.supportedValuesOf("timeZone");
  } catch {
    // An older browser: Australia's alone, below.
  }
  // prettier-ignore
  const aus = [
    "Australia/Brisbane", "Australia/Sydney", "Australia/Melbourne", "Australia/Canberra", "Australia/Hobart",
    "Australia/Adelaide", "Australia/Broken_Hill", "Australia/Darwin", "Australia/Perth", "Australia/Eucla",
    "Australia/Lord_Howe",
  ];
  return { aus, rest: all.filter((z) => !aus.includes(z) && !LEGACY.has(z)) };
})();

/** The time zone: the location's own (automatic), or one chosen. */
function TimeZone({ chosen, found }: { chosen: string; found: string | null }) {
  const save = useSaveSettings();
  const toast = useToast();
  const value = (save.isPending ? save.variables?.time_zone : chosen) ?? "auto";
  const known = value === "auto" || ZONES.aus.includes(value) || ZONES.rest.includes(value);
  // Typing narrows the list to the zones whose name has it ("syd", "new york"); the chosen one always stays in.
  const [find, setFind] = useState("");
  const q = find.trim().toLowerCase().replace(/\s+/g, "_");
  const shown = (zones: string[]) => (q ? zones.filter((z) => z === value || z.toLowerCase().includes(q)) : zones);
  const aus = shown(ZONES.aus);
  const rest = shown(ZONES.rest);
  return (
    <div className="flex flex-col items-end gap-2">
      <Input
        aria-label="Find a time zone"
        placeholder="Find a time zone"
        value={find}
        onChange={(e) => setFind(e.target.value)}
        className="h-9 w-[260px] max-w-full text-sm"
      />
      <Select
        aria-label="Time zone"
        value={value}
        onChange={(e) =>
          save.mutate(
            { time_zone: e.target.value },
            {
              onSuccess: () => toast("Saved. Days and times follow it now."),
              onError: (err) => toast(saveSettingsError(err)),
            },
          )
        }
        className="h-9 max-w-[260px] text-sm"
      >
        <option value="auto">{found ? `Automatic (${zoneLabel(found)})` : "Automatic (from your location)"}</option>
        {!known && <option value={value}>{zoneLabel(value)}</option>}
        {aus.length > 0 && (
          <optgroup label="Australia">
            {aus.map((z) => (
              <option key={z} value={z}>
                {zoneLabel(z.replace("Australia/", ""))}
              </option>
            ))}
          </optgroup>
        )}
        {rest.length > 0 && (
          <optgroup label="Everywhere else">
            {rest.map((z) => (
              <option key={z} value={z}>
                {zoneLabel(z)}
              </option>
            ))}
          </optgroup>
        )}
      </Select>
    </div>
  );
}

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
      <SettingsPageHeader
        title="Location"
        sub="Where your system is. The solar forecast, sunrise and sunset, and your grid region all depend on it."
      />
      <SettingsSplit
        visual={
          <SettingsSection
            id="h-daylight"
            title="Daylight"
            sub={
              set ? `Sunrise and sunset at ${locationLabel(s)}.` : "Set your location to see its sunrise and sunset."
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
            <OptionRow label="Time zone" help="Where your days roll over, and the times you see here.">
              <TimeZone chosen={s?.time_zone ?? "auto"} found={s?.location_zone ?? null} />
            </OptionRow>
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
