import { useId, useState, type CSSProperties } from "react";
import type { SystemInfo } from "~/features/common/live/types";
import { useLive } from "~/features/common/live/hooks/useLive";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { inverterName } from "~/features/common/live/utils";
import { useSaveSettings } from "~/features/common/settings/hooks";
import type { Settings } from "~/features/common/settings/types";
import { saveSettingsError } from "~/features/common/settings/utils";
import { Select } from "~/features/common/ui/components/Field";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { Switch } from "~/features/common/ui/components/Switch";
import { useToast } from "~/features/common/ui/components/Toast";
import { cn } from "~/features/common/ui/utils";
import { HouseScene, type HouseFlows } from "~/features/overview/components/HouseScene";
import {
  MAX_PANELS,
  type Fence,
  type Garden,
  type GarageKind,
  type HouseOptions,
  type HouseStyle,
  type Place,
} from "~/features/overview/utils/house/layout";
import { houseOptions, panelsFor } from "~/features/overview/utils/house/options";
import {
  FINISHES,
  ROOF_COLOURS,
  ROOFS,
  WALL_FINISHES,
  type Finish,
  type RoofColour,
  type WallFinish,
} from "~/features/overview/utils/house/palette";
import { STYLES } from "~/features/overview/utils/house/scenery";
import { COLOR } from "~/features/common/theme/utils/colors";
import { ChoiceTiles, OptionList, OptionRow, SettingsSection } from "~/features/settings/components/SettingsSection";
import { SettingsPageHeader } from "~/features/settings/components/SubPageHeader";

type HouseValues = Pick<
  Settings,
  | "house_style"
  | "house_storeys"
  | "garage_spaces"
  | "garage_kind"
  | "house_walls"
  | "house_roof"
  | "house_fence"
  | "house_garden"
  | "house_panels"
  | "house_pool"
  | "inverter_places"
  | "battery_places"
>;

export const HOUSE_STYLES: { value: HouseStyle; name: string; blurb: string }[] = [
  { value: "estate", name: "Estate", blurb: "Rendered brick veneer under a tiled gable roof" },
  { value: "brick", name: "Brick and tile", blurb: "Face brick under a hip roof of concrete tiles" },
  { value: "modern", name: "Modern", blurb: "White boxes, glass and a flat roof" },
  { value: "coastal", name: "Coastal", blurb: "Weatherboards and glass under a skillion roof" },
  { value: "queenslander", name: "Queenslander", blurb: "Weatherboards on stumps, a verandah and an iron roof" },
  { value: "federation", name: "Federation", blurb: "Red brick, terracotta tiles and a bay window" },
  { value: "bungalow", name: "Californian bungalow", blurb: "A low gable to the street and a porch on piers" },
  { value: "farmhouse", name: "Farmhouse", blurb: "Dark cladding, a steep metal roof and a deck" },
  {
    value: "townhouse",
    name: "Townhouse",
    blurb: "One half of a pair, a balcony upstairs (a villa unit on one level)",
  },
];

const PLACES: { value: Place; label: string }[] = [
  { value: "wall", label: "Outside wall" },
  { value: "garage", label: "Garage" },
];

const KINDS: { value: GarageKind; label: string }[] = [
  { value: "garage", label: "Garage" },
  { value: "carport", label: "Carport" },
];

const FENCES: Record<Fence, string> = {
  none: "No fence",
  picket: "White pickets",
  slat: "Steel slats",
  hedge: "A hedge",
};
const GARDENS: Record<Garden, string> = {
  leafy: "Leafy trees",
  native: "Gum trees",
  tropical: "Palms",
  minimal: "No trees",
};

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

/** A wall finish's swatch: its colour, with its material's lines over it (mortar, board edges, battens). */
function finishBackground(f: Finish): CSSProperties {
  const lines =
    f.material === "brick"
      ? "repeating-linear-gradient(0deg, rgba(255,244,230,0.4) 0 1px, transparent 1px 5px)"
      : f.material === "boards"
        ? "repeating-linear-gradient(0deg, rgba(0,0,0,0.14) 0 1px, transparent 1px 6px)"
        : f.material === "battens"
          ? `repeating-linear-gradient(90deg, ${f.line} 0 1.5px, transparent 1.5px 6px)`
          : undefined;
  return { background: lines ? `${lines}, ${f.face}` : f.face };
}

/**
 * One of a few colours, as round swatches: the first is the style's own ("auto"), the chosen one ringed, its name
 * under them.
 */
function Swatches<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; name: string; style: CSSProperties }[];
  onChange: (v: T) => void;
}) {
  const id = useId();
  const chosen = options.find((o) => o.value === value) ?? options[0];
  return (
    <div className="flex flex-col gap-2">
      <span id={id} className="text-[13px] font-semibold">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-1.5">
        {options.map((o, i) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === chosen.value}
            aria-label={o.name}
            title={o.name}
            onClick={() => o.value !== chosen.value && onChange(o.value)}
            className={cn(
              "relative size-8 rounded-full border border-fg/20 transition-shadow",
              o.value === chosen.value && "shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-ink)]",
            )}
            style={o.style}
          >
            {i === 0 && (
              <span className="absolute -right-1 -bottom-1 rounded-full bg-ink px-1 text-[9px] leading-[14px] font-bold text-ink-inverse">
                A
              </span>
            )}
          </button>
        ))}
      </div>
      <span className="text-xs text-ink-muted">{chosen.name}</span>
    </div>
  );
}

/** A count with − and + either side. */
function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const btn =
    "flex size-9 items-center justify-center rounded-full text-lg font-semibold text-ink transition-[background-color,transform] hover:bg-fg/8 active:scale-95 disabled:opacity-40";
  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-center gap-1 rounded-full border border-chip-line bg-canvas p-0.5"
    >
      <button
        type="button"
        aria-label="Fewer"
        className={btn}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <span aria-live="polite" className="min-w-8 text-center text-[15px] font-semibold tabular-nums">
        {value}
      </span>
      <button
        type="button"
        aria-label="More"
        className={btn}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}

/**
 * Settings → Your house: how the Overview draws the house. Side by side from a wide screen: the house and its
 * kind on the left, kept in view; its size, its look, the garden, and where each inverter and battery is on the right.
 */
export function HouseSettings() {
  const live = useLive();
  return (
    <>
      <SettingsPageHeader
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
    garage_kind: system.garage_kind ?? "garage",
    house_walls: system.house_walls ?? "auto",
    house_roof: system.house_roof ?? "auto",
    house_fence: system.house_fence ?? "auto",
    house_garden: system.house_garden ?? "auto",
    house_panels: system.house_panels ?? 0,
    house_pool: system.house_pool ?? 0,
    inverter_places: system.inverter_places,
    battery_places: system.battery_places,
  }));
  const set = (changes: Partial<HouseValues>) => {
    setValues((v) => ({ ...v, ...changes }));
    save.mutate(changes, { onError: (e) => toast(saveSettingsError(e)) });
  };
  const house = houseOptions({ ...system, ...values });
  const own = STYLES[house.style].look;
  const garage = values.garage_spaces > 0;
  const carport = garage && values.garage_kind === "carport";
  const attached = house.style === "townhouse";
  const arrayPanels = panelsFor(system.pv_kw);

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
        {/* The house and its kind on the left; its size, look and garden, and what goes where, on the right. */}
        <div className="flex min-w-0 flex-col gap-5">
          <section
            aria-label="Preview"
            className="relative aspect-[16/9] w-full overflow-hidden rounded-3xl border border-line-subtle bg-[#dcebff] max-sm:aspect-[4/3] max-sm:rounded-[20px]"
          >
            <HouseScene flows={previewFlows(snapshot, system)} sky="sunny" house={house} />
          </section>
          <SettingsSection id="h-house-style" title="Kind of house" sub="Its shape: walls, roof, windows and porch.">
            <ChoiceTiles
              label="Kind of house"
              min="10.5rem"
              value={house.style}
              onChange={(v) => set({ house_style: v })}
              options={HOUSE_STYLES.map((st) => ({
                value: st.value,
                title: st.name,
                sub: st.blurb,
                preview: <Thumb house={{ ...house, style: st.value, walls: null, roof: null }} />,
              }))}
            />
          </SettingsSection>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <SettingsSection id="h-house-size" title="Size" sub="How many storeys, and the garage or carport beside it.">
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-semibold">Car spaces</span>
                {garage && (
                  <Segmented
                    label="Garage or carport"
                    options={KINDS}
                    value={values.garage_kind}
                    onChange={(v) => set({ garage_kind: v })}
                    buttonClassName="px-3 py-1.5 text-[13px]"
                  />
                )}
              </div>
              <ChoiceTiles
                label="Car spaces"
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

          <SettingsSection id="h-house-look" title="Look" sub="The walls and the roof. A is the kind of house's own.">
            <Swatches<"auto" | WallFinish>
              label="Walls"
              value={values.house_walls}
              onChange={(v) => set({ house_walls: v })}
              options={[
                {
                  value: "auto",
                  name: `Its own: ${FINISHES[own.walls].name}`,
                  style: finishBackground(FINISHES[own.walls]),
                },
                ...WALL_FINISHES.map((k) => ({
                  value: k,
                  name: FINISHES[k].name,
                  style: finishBackground(FINISHES[k]),
                })),
              ]}
            />
            <Swatches<"auto" | RoofColour>
              label="Roof"
              value={values.house_roof}
              onChange={(v) => set({ house_roof: v })}
              options={[
                {
                  value: "auto",
                  name: `Its own: ${ROOFS[own.roof].name}`,
                  style: { background: ROOFS[own.roof].face },
                },
                ...ROOF_COLOURS.map((k) => ({ value: k, name: ROOFS[k].name, style: { background: ROOFS[k].face } })),
              ]}
            />
          </SettingsSection>

          <SettingsSection id="h-house-outside" title="Outside" sub="The panels on the roof, and the garden.">
            <OptionList>
              <OptionRow
                label="Solar panels"
                icon="sun"
                color={COLOR.solar}
                help={
                  values.house_panels ? (
                    <>
                      Your {system.pv_kw} kW array is about {arrayPanels}.{" "}
                      <button
                        type="button"
                        className="font-semibold text-ink underline-offset-2 hover:underline"
                        onClick={() => set({ house_panels: 0 })}
                      >
                        Match it
                      </button>
                    </>
                  ) : (
                    `As many as your ${system.pv_kw} kW array needs. The roof shows as many as fit on the sides you see.`
                  )
                }
              >
                <Stepper
                  label="Solar panels"
                  value={values.house_panels || arrayPanels}
                  min={1}
                  max={MAX_PANELS}
                  onChange={(n) => set({ house_panels: n })}
                />
              </OptionRow>
              <OptionRow
                label="Pool"
                icon="droplet"
                color={COLOR.battery}
                help={attached ? "There's no room beside a townhouse for one." : "In the garden beside the house."}
              >
                <Switch
                  label="Pool"
                  on={!!values.house_pool && !attached}
                  disabled={attached}
                  onChange={(on) => set({ house_pool: on ? 1 : 0 })}
                />
              </OptionRow>
              <OptionRow label="Fence" help="Along the street.">
                <Select
                  aria-label="Fence"
                  value={values.house_fence}
                  onChange={(e) => set({ house_fence: e.target.value as HouseValues["house_fence"] })}
                  className="h-10 bg-surface light:bg-surface"
                >
                  <option value="auto">Its own ({FENCES[own.fence].toLowerCase()})</option>
                  {(Object.keys(FENCES) as Fence[]).map((k) => (
                    <option key={k} value={k}>
                      {FENCES[k]}
                    </option>
                  ))}
                </Select>
              </OptionRow>
              <OptionRow label="Trees" help="In the garden.">
                <Select
                  aria-label="Trees"
                  value={values.house_garden}
                  onChange={(e) => set({ house_garden: e.target.value as HouseValues["house_garden"] })}
                  className="h-10 bg-surface light:bg-surface"
                >
                  <option value="auto">Its own ({GARDENS[own.garden].toLowerCase()})</option>
                  {(Object.keys(GARDENS) as Garden[]).map((k) => (
                    <option key={k} value={k}>
                      {GARDENS[k]}
                    </option>
                  ))}
                </Select>
              </OptionRow>
            </OptionList>
          </SettingsSection>

          <SettingsSection
            id="h-house-units"
            title={house.batteries.length ? "Inverters and battery" : "Inverters"}
            sub={
              carport
                ? "They're on the house's wall under the carport, seen through its clear roof."
                : garage
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
                  {garage && !carport ? (
                    <Segmented
                      label={u.name}
                      options={PLACES}
                      value={u.value}
                      onChange={u.onChange}
                      className="w-fit max-w-full max-sm:w-full"
                      buttonClassName="max-sm:flex-1 max-sm:justify-center max-sm:px-2.5"
                    />
                  ) : (
                    <span className="text-sm text-ink-muted">{carport ? "Under the carport" : "Outside wall"}</span>
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
