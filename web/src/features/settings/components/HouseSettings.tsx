import { useState } from "react";
import type { SystemInfo } from "~/features/common/live/types";
import { useLive } from "~/features/common/live/hooks/useLive";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { inverterName } from "~/features/common/live/utils";
import { useSaveSettings } from "~/features/common/settings/hooks";
import type { Settings } from "~/features/common/settings/types";
import { saveSettingsError } from "~/features/common/settings/utils";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { useToast } from "~/features/common/ui/components/Toast";
import { HouseScene, type HouseFlows } from "~/features/overview/components/HouseScene";
import type { HouseOptions, HouseStyle, Place } from "~/features/overview/utils/house/layout";
import { houseOptions } from "~/features/overview/utils/house/options";
import { COLOR } from "~/features/common/theme/utils/colors";
import { ChoiceTiles, OptionList, OptionRow, SettingsSection } from "~/features/settings/components/SettingsSection";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

type HouseValues = Pick<
  Settings,
  "house_style" | "house_storeys" | "garage_spaces" | "inverter_places" | "battery_places"
>;

export const HOUSE_STYLES: { value: HouseStyle; name: string; blurb: string }[] = [
  { value: "estate", name: "Estate", blurb: "Brick veneer under a tiled gable roof" },
  { value: "modern", name: "Modern", blurb: "White boxes, glass and a flat roof" },
  { value: "queenslander", name: "Queenslander", blurb: "Weatherboards on stumps, a verandah and an iron roof" },
  { value: "federation", name: "Federation", blurb: "Red brick, terracotta tiles and a bay window" },
  { value: "farmhouse", name: "Farmhouse", blurb: "Dark cladding, a steep metal roof and a deck" },
];

const PLACES: { value: Place; label: string }[] = [
  { value: "wall", label: "Outside wall" },
  { value: "garage", label: "Garage" },
];

/** The style tiles show the house still: no power moving, so a page of them stays quiet. */
export const THUMB_FLOWS: HouseFlows = { pv: 0, grid: 0, bat: 0, soc: 0.6, tesla: 0, conn: false };

/** A choice's picture: the house with it, still. */
function Thumb({ house }: { house: HouseOptions }) {
  return (
    <span className="relative block aspect-[2/1] w-full bg-[#dcebff]">
      <HouseScene flows={THUMB_FLOWS} sky="sunny" house={house} />
    </span>
  );
}

/** What the preview shows: the live readings if there are some, else a sunny afternoon charging the battery. */
function previewFlows(p: ReturnType<typeof useSnapshot>, s: SystemInfo): HouseFlows {
  if (!p) return { pv: 4.2, grid: -1.1, bat: 1.6, soc: 0.62, tesla: 0, conn: false };
  return {
    pv: (p.pv_power || 0) / 1000,
    grid: (p.grid_power || 0) / 1000,
    bat: -(p.battery_power || 0) / 1000,
    soc: (p.battery_soc || 0) / 100,
    tesla: 0,
    conn: false,
    pvEach: s.pv2 && p.pv2_power != null ? [(p.pv1_power ?? 0) / 1000, p.pv2_power / 1000] : undefined,
  };
}

/**
 * Manage → System → Your house: how the Overview draws the house. Side by side from a wide screen: the house and its
 * style on the left, kept in view; storeys, a garage, and where each inverter and battery is on the right.
 */
export function HouseSettings() {
  const live = useLive();
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/system">System</BackLink>}
        id="h-house"
        title="Your house"
        sub="How the Overview draws your home. Choose what's closest: it's only the picture, nothing's worked out from it."
      />
      {/* Mounted once the status has loaded, so the choices start from the saved ones. */}
      {live && <HouseCard system={live.system} />}
    </>
  );
}

function HouseCard({ system }: { system: SystemInfo }) {
  const save = useSaveSettings();
  const toast = useToast();
  const snapshot = useSnapshot();
  // Changes show straight away and save in the background.
  const [values, setValues] = useState<HouseValues>(() => ({
    house_style: system.house_style,
    house_storeys: system.house_storeys,
    garage_spaces: system.garage_spaces,
    inverter_places: system.inverter_places,
    battery_places: system.battery_places,
  }));
  const set = (changes: Partial<HouseValues>) => {
    setValues((v) => ({ ...v, ...changes }));
    save.mutate(changes, { onError: (e) => toast(saveSettingsError(e)) });
  };
  const house = houseOptions({ ...system, ...values });
  const garage = values.garage_spaces > 0;

  const units = [
    ...house.inverters.map((p, i) => ({
      key: `inverter-${i}`,
      name:
        i === 0
          ? `${system.model ? inverterName(system) : "Main"} inverter`
          : `${system.pv2?.model ? inverterName(system.pv2) : "Second"} inverter`,
      value: p,
      onChange: (to: Place) => set({ inverter_places: house.inverters.map((q, k) => (k === i ? to : q)) }),
    })),
    ...house.batteries.map((p, i) => ({
      key: `battery-${i}`,
      name: house.batteries.length > 1 ? `Battery ${i + 1}` : "Battery",
      value: p,
      onChange: (to: Place) => set({ battery_places: house.batteries.map((q, k) => (k === i ? to : q)) }),
    })),
  ];

  return (
    <div className="@container">
      <div className="grid grid-cols-1 items-start gap-5 @4xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
        {/* The house and its look on the left; its size, and what goes where, on the right. */}
        <div className="flex min-w-0 flex-col gap-5">
          <section
            aria-label="Preview"
            className="relative aspect-[16/9] w-full overflow-hidden rounded-3xl border border-line-subtle bg-[#dcebff] max-sm:aspect-[4/3] max-sm:rounded-[20px]"
          >
            <HouseScene flows={previewFlows(snapshot, system)} sky="sunny" house={house} />
          </section>
          <SettingsSection id="h-house-style" title="Style" sub="The look of the house: walls, roof and windows.">
            <ChoiceTiles
              label="Style"
              min="10.5rem"
              value={house.style}
              onChange={(v) => set({ house_style: v })}
              options={HOUSE_STYLES.map((st) => ({
                value: st.value,
                title: st.name,
                sub: st.blurb,
                preview: <Thumb house={{ ...house, style: st.value }} />,
              }))}
            />
          </SettingsSection>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <SettingsSection id="h-house-size" title="Size" sub="How many storeys, and the garage beside it.">
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold">Storeys</span>
              <ChoiceTiles
                label="Storeys"
                min="8rem"
                value={String(values.house_storeys)}
                onChange={(v) => set({ house_storeys: +v })}
                options={[
                  { value: "1", title: "Single storey", preview: <Thumb house={{ ...house, storeys: 1 }} /> },
                  { value: "2", title: "Double storey", preview: <Thumb house={{ ...house, storeys: 2 }} /> },
                ]}
              />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold">Garage</span>
              <ChoiceTiles
                label="Garage"
                min="7rem"
                phone={3}
                value={String(values.garage_spaces)}
                onChange={(v) => set({ garage_spaces: +v })}
                options={[
                  { value: "0", title: "None", preview: <Thumb house={{ ...house, garage: 0 }} /> },
                  { value: "1", title: "Single", preview: <Thumb house={{ ...house, garage: 1 }} /> },
                  { value: "2", title: "Double", preview: <Thumb house={{ ...house, garage: 2 }} /> },
                ]}
              />
            </div>
          </SettingsSection>

          <SettingsSection
            id="h-house-units"
            title="Inverters and battery"
            sub={
              garage
                ? "Where each one is: on an outside wall, or in the garage (drawn see-through, so what's inside shows)."
                : "They're on the house's outside wall. Add a garage to put any of them inside it."
            }
          >
            <OptionList>
              {units.map((u) => (
                <OptionRow
                  key={u.key}
                  label={u.name}
                  icon={u.key.startsWith("battery") ? "battery" : "bolt"}
                  color={u.key.startsWith("battery") ? COLOR.battery : COLOR.solar}
                >
                  {garage ? (
                    <Segmented
                      label={u.name}
                      options={PLACES}
                      value={u.value}
                      onChange={u.onChange}
                      className="w-fit max-w-full max-sm:w-full"
                      buttonClassName="max-sm:flex-1 max-sm:justify-center max-sm:px-2.5"
                    />
                  ) : (
                    <span className="text-sm text-ink-muted">Outside wall</span>
                  )}
                </OptionRow>
              ))}
            </OptionList>
          </SettingsSection>
        </div>
      </div>
    </div>
  );
}
