import { useState, type ReactNode } from "react";
import type { SystemInfo } from "~/features/common/live/types";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { inverterName } from "~/features/common/live/utils";
import { useSaveSettings } from "~/features/common/settings/hooks";
import type { Settings } from "~/features/common/settings/types";
import { saveSettingsError } from "~/features/common/settings/utils";
import { HelpText } from "~/features/common/ui/components/Field";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { useToast } from "~/features/common/ui/components/Toast";
import { HouseScene, type HouseFlows } from "~/features/overview/components/HouseScene";
import type { Place } from "~/features/overview/utils/house/layout";
import { houseOptions } from "~/features/overview/utils/house/options";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";

type HouseValues = Pick<Settings, "house_storeys" | "garage_spaces" | "inverter_places" | "battery_places">;

const PLACES: { value: Place; label: string }[] = [
  { value: "wall", label: "Outside wall" },
  { value: "garage", label: "In the garage" },
];

/** A labelled row of choices; on a phone they share the width. */
function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold">{label}</span>
      <Segmented
        label={label}
        options={options}
        value={value}
        onChange={onChange}
        className="w-fit max-w-full max-sm:w-full"
        buttonClassName="max-sm:flex-1 max-sm:justify-center max-sm:px-2.5"
      />
    </div>
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
 * Settings → System → Your house: how the Overview draws the house. Storeys, a garage, and where each inverter and
 * battery is (as many as are connected), with the drawing updating as they're chosen.
 */
export function HouseSettings({ system }: { system: SystemInfo }) {
  const save = useSaveSettings();
  const toast = useToast();
  const snapshot = useSnapshot();
  // Changes show straight away and save in the background.
  const [values, setValues] = useState<HouseValues>(() => ({
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
    <SettingsCard padded aria-labelledby="h-house">
      <SettingsTitle
        id="h-house"
        title="Your house"
        sub="How the Overview draws your home. Choose what's closest: it's only the picture, nothing's worked out from it."
      />
      <div className="relative aspect-[2/1] w-full overflow-hidden rounded-2xl bg-[#dcebff] max-sm:aspect-[4/3]">
        <HouseScene flows={previewFlows(snapshot, system)} sky="sunny" house={house} leaders={false} />
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 max-md:grid-cols-1">
        <Choice
          label="Storeys"
          options={[
            { value: "1", label: "Single storey" },
            { value: "2", label: "Double storey" },
          ]}
          value={String(values.house_storeys)}
          onChange={(v) => set({ house_storeys: +v })}
        />
        <Choice
          label="Garage"
          options={[
            { value: "0", label: "None" },
            { value: "1", label: "Single" },
            { value: "2", label: "Double" },
          ]}
          value={String(values.garage_spaces)}
          onChange={(v) => set({ garage_spaces: +v })}
        />
      </div>
      <div className="flex flex-col gap-4 border-t border-line-subtle pt-5">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold">Where your inverters and battery are</span>
          <HelpText>
            One for each inverter connected in Integrations, and the hybrid's battery.
            {garage
              ? " Each can be on an outside wall or in the garage."
              : " They're on the house's outside wall: add a garage to put any of them inside it."}
          </HelpText>
        </div>
        {garage && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 max-md:grid-cols-1">
            {units.map((u) => (
              <Choice key={u.key} label={u.name} options={PLACES} value={u.value} onChange={u.onChange} />
            ))}
          </div>
        )}
        {garage && units.some((u) => u.value === "garage") && (
          <HelpText>The garage is drawn see-through, so what's inside shows.</HelpText>
        )}
      </div>
    </SettingsCard>
  );
}
