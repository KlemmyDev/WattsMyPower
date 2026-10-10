import { useId, useState, type CSSProperties, type ReactNode } from "react";
import type { SystemInfo } from "~/features/common/live/types";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { inverterName } from "~/features/common/live/utils";
import { useSaveSettings } from "~/features/common/settings/hooks";
import type { Settings } from "~/features/common/settings/types";
import { saveSettingsError } from "~/features/common/settings/utils";
import { COLOR } from "~/features/common/theme/utils/colors";
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
import { ChoiceTiles, OptionList, OptionRow } from "~/features/settings/components/SettingsSection";

/*
 * Settings → Your house's choices, shared by its two layouts: side by side on a wide screen (HouseSettings), and on a
 * phone the house with a dot on each part to tap, its choices in a sheet (HousePhone). Each choice changes the picture
 * straight away and saves in the background.
 */

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

/** One inverter or battery, and where it hangs. */
type UnitChoice = { key: string; name: string; battery: boolean; value: Place; onChange: (to: Place) => void };

/** The house being edited: what's chosen, the house it draws, and a way to change it. */
export type HouseEditor = {
  system: SystemInfo;
  values: HouseValues;
  set: (changes: Partial<HouseValues>) => void;
  house: HouseOptions;
  /** How the kind of house looks unless something else is chosen. */
  own: (typeof STYLES)[HouseStyle]["look"];
  garage: boolean;
  carport: boolean;
  /** A townhouse: joined to its neighbour, so there's no room for a pool. */
  attached: boolean;
  /** The panels the array would have. */
  arrayPanels: number;
  /** A change is on its way to the server. */
  saving: boolean;
  units: UnitChoice[];
};

/** The choices, starting from the saved ones; a change shows straight away and saves in the background. */
export function useHouseEditor(system: SystemInfo): HouseEditor {
  const save = useSaveSettings();
  const toast = useToast();
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
  const garage = values.garage_spaces > 0;
  const units: UnitChoice[] = [
    ...house.inverters.map((p, i) => ({
      key: `inverter-${i}`,
      name:
        i === 0
          ? `${system.model ? inverterName(system) : "Main"} inverter`
          : `${system.pv2?.model ? inverterName(system.pv2) : "Second"} inverter`,
      battery: false,
      value: p,
      onChange: (to: Place) => set({ inverter_places: house.inverters.map((q, k) => (k === i ? to : q)) }),
    })),
    ...house.batteries.map((p, i) => ({
      key: `battery-${i}`,
      name: house.batteries.length > 1 ? `Battery ${i + 1}` : "Battery",
      battery: true,
      value: p,
      onChange: (to: Place) => set({ battery_places: house.batteries.map((q, k) => (k === i ? to : q)) }),
    })),
  ];
  return {
    system,
    values,
    set,
    house,
    own: STYLES[house.style].look,
    garage,
    carport: garage && values.garage_kind === "carport",
    attached: house.style === "townhouse",
    arrayPanels: panelsFor(system.pv_kw),
    saving: save.isPending,
    units,
  };
}

/**
 * The house as it's set, with power moving through it: drawn as the Overview would, changing with every choice.
 * `children` sit over it (the phone's dots).
 */
export function HousePreview({ e, className, children }: { e: HouseEditor; className?: string; children?: ReactNode }) {
  const snapshot = useSnapshot();
  return (
    <section
      aria-label="Preview"
      className={cn(
        "relative w-full overflow-hidden rounded-3xl border border-line-subtle bg-[#dcebff] max-sm:rounded-[20px]",
        className,
      )}
    >
      <HouseScene flows={previewFlows(snapshot, e.system)} sky="sunny" house={e.house} />
      {children}
    </section>
  );
}

/** Under the picture: that changes save as they're made (and while one is). `hint`: what to do first, on a phone. */
export function SaveNote({ e, hint, className }: { e: HouseEditor; hint?: string; className?: string }) {
  return (
    <p aria-live="polite" className={cn("px-1 text-[13px] text-pretty text-ink-muted", className)}>
      {e.saving ? "Saving…" : `${hint ? `${hint} ` : ""}Changes save as you make them.`}
    </p>
  );
}

/** Each kind of house as a tile with its picture. */
export function KindTiles({ e, min = "10.5rem" }: { e: HouseEditor; min?: string }) {
  return (
    <ChoiceTiles
      label="Kind of house"
      min={min}
      value={e.house.style}
      onChange={(v) => e.set({ house_style: v })}
      options={HOUSE_STYLES.map((st) => ({
        value: st.value,
        title: st.name,
        sub: st.blurb,
        preview: <Thumb house={{ ...e.house, style: st.value, walls: null, roof: null }} />,
      }))}
    />
  );
}

/** Single or double storey, as two pictures. */
export function StoreyTiles({ e }: { e: HouseEditor }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold">Storeys</span>
      <ChoiceTiles
        label="Storeys"
        min="8rem"
        value={String(e.values.house_storeys)}
        onChange={(v) => e.set({ house_storeys: +v })}
        options={[
          { value: "1", title: "Single storey", preview: <Thumb house={{ ...e.house, storeys: 1 }} /> },
          { value: "2", title: "Double storey", preview: <Thumb house={{ ...e.house, storeys: 2 }} /> },
        ]}
      />
    </div>
  );
}

/** How many car spaces, as pictures, and whether they're a garage or a carport. */
export function CarSpaces({ e }: { e: HouseEditor }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-semibold">Car spaces</span>
        {e.garage && (
          <Segmented
            label="Garage or carport"
            options={KINDS}
            value={e.values.garage_kind}
            onChange={(v) => e.set({ garage_kind: v })}
            buttonClassName="px-3 py-1.5 text-[13px]"
          />
        )}
      </div>
      <ChoiceTiles
        label="Car spaces"
        min="7rem"
        phone={3}
        value={String(e.values.garage_spaces)}
        onChange={(v) => e.set({ garage_spaces: +v })}
        options={[
          { value: "0", title: "None", preview: <Thumb house={{ ...e.house, garage: 0 }} /> },
          { value: "1", title: "Single", preview: <Thumb house={{ ...e.house, garage: 1 }} /> },
          { value: "2", title: "Double", preview: <Thumb house={{ ...e.house, garage: 2 }} /> },
        ]}
      />
    </div>
  );
}

export function WallSwatches({ e }: { e: HouseEditor }) {
  return (
    <Swatches<"auto" | WallFinish>
      label="Walls"
      value={e.values.house_walls}
      onChange={(v) => e.set({ house_walls: v })}
      options={[
        {
          value: "auto",
          name: `Its own: ${FINISHES[e.own.walls].name}`,
          style: finishBackground(FINISHES[e.own.walls]),
        },
        ...WALL_FINISHES.map((k) => ({ value: k, name: FINISHES[k].name, style: finishBackground(FINISHES[k]) })),
      ]}
    />
  );
}

export function RoofSwatches({ e }: { e: HouseEditor }) {
  return (
    <Swatches<"auto" | RoofColour>
      label="Roof"
      value={e.values.house_roof}
      onChange={(v) => e.set({ house_roof: v })}
      options={[
        { value: "auto", name: `Its own: ${ROOFS[e.own.roof].name}`, style: { background: ROOFS[e.own.roof].face } },
        ...ROOF_COLOURS.map((k) => ({ value: k, name: ROOFS[k].name, style: { background: ROOFS[k].face } })),
      ]}
    />
  );
}

/** The panels on the roof: as many as the array needs, or counted. */
export function PanelsRow({ e }: { e: HouseEditor }) {
  const kw = e.system.pv_kw;
  return (
    <OptionRow
      label="Solar panels"
      icon="sun"
      color={COLOR.solar}
      help={
        e.values.house_panels ? (
          <>
            Your {kw} kW array is about {e.arrayPanels}.{" "}
            <button
              type="button"
              className="font-semibold text-ink underline-offset-2 hover:underline"
              onClick={() => e.set({ house_panels: 0 })}
            >
              Match it
            </button>
          </>
        ) : (
          `As many as your ${kw} kW array needs. The roof shows as many as fit on the sides you see.`
        )
      }
    >
      <Stepper
        label="Solar panels"
        value={e.values.house_panels || e.arrayPanels}
        min={1}
        max={MAX_PANELS}
        onChange={(n) => e.set({ house_panels: n })}
      />
    </OptionRow>
  );
}

/** The garden: a pool, the fence along the street, and the trees. */
export function GardenRows({ e }: { e: HouseEditor }) {
  return (
    <>
      <OptionRow
        label="Pool"
        icon="droplet"
        color={COLOR.battery}
        help={e.attached ? "There's no room beside a townhouse for one." : "In the garden beside the house."}
      >
        <Switch
          label="Pool"
          on={!!e.values.house_pool && !e.attached}
          disabled={e.attached}
          onChange={(on) => e.set({ house_pool: on ? 1 : 0 })}
        />
      </OptionRow>
      <OptionRow label="Fence" help="Along the street.">
        <Select
          aria-label="Fence"
          value={e.values.house_fence}
          onChange={(ev) => e.set({ house_fence: ev.target.value as HouseValues["house_fence"] })}
          className="h-10 bg-surface light:bg-surface"
        >
          <option value="auto">Its own ({FENCES[e.own.fence].toLowerCase()})</option>
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
          value={e.values.house_garden}
          onChange={(ev) => e.set({ house_garden: ev.target.value as HouseValues["house_garden"] })}
          className="h-10 bg-surface light:bg-surface"
        >
          <option value="auto">Its own ({GARDENS[e.own.garden].toLowerCase()})</option>
          {(Object.keys(GARDENS) as Garden[]).map((k) => (
            <option key={k} value={k}>
              {GARDENS[k]}
            </option>
          ))}
        </Select>
      </OptionRow>
    </>
  );
}

/** What the inverters-and-battery choices are called. */
export const unitsTitle = (e: HouseEditor) => (e.house.batteries.length ? "Inverters and battery" : "Inverters");

/** Where the inverters and battery can go, in a line. */
export const unitsSub = (e: HouseEditor) =>
  e.carport
    ? "They're on the house's wall under the carport, seen through its clear roof."
    : e.garage
      ? "Where each one is: on an outside wall, or in the garage (drawn see-through, so what's inside shows)."
      : "They're on the house's outside wall. Add a garage to put any of them inside it.";

/** Each inverter and battery, and where it hangs: on an outside wall or in the garage, when there's one. */
export function UnitRows({ e }: { e: HouseEditor }) {
  return (
    <OptionList>
      {e.units.map((u) => (
        <OptionRow
          key={u.key}
          label={u.name}
          icon={u.battery ? "battery" : "bolt"}
          color={u.battery ? COLOR.battery : COLOR.solar}
        >
          {e.garage && !e.carport ? (
            <Segmented
              label={u.name}
              options={PLACES}
              value={u.value}
              onChange={u.onChange}
              className="w-fit max-w-full max-sm:w-full"
              buttonClassName="max-sm:flex-1 max-sm:justify-center max-sm:px-2.5"
            />
          ) : (
            <span className="text-sm text-ink-muted">{e.carport ? "Under the carport" : "Outside wall"}</span>
          )}
        </OptionRow>
      ))}
    </OptionList>
  );
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** What's chosen for each part, in a few words: for the phone's list of parts. */
export function summaries(e: HouseEditor) {
  const { house, own } = e;
  const kind = HOUSE_STYLES.find((st) => st.value === house.style)?.name ?? "";
  const inGarage = [...house.inverters, ...house.batteries].filter((p) => p === "garage").length;
  const all = house.inverters.length + house.batteries.length;
  return {
    kind: `${kind}, ${house.storeys === 2 ? "double" : "single"} storey`,
    roof: `${ROOFS[house.roof ?? own.roof].name}, ${house.panels} panels`,
    walls: FINISHES[house.walls ?? own.walls].name,
    cars: house.garage ? `${house.garage === 2 ? "Double" : "Single"} ${house.garageKind}` : "No garage or carport",
    garden: [house.pool ? "Pool" : null, FENCES[house.fence ?? own.fence], GARDENS[house.garden ?? own.garden]]
      .filter((s): s is string => !!s)
      .map((s, i) => (i ? lower(s) : s))
      .join(", "),
    units: e.carport
      ? "Under the carport"
      : e.garage && inGarage
        ? inGarage === all
          ? "In the garage"
          : `${inGarage} in the garage, ${all - inGarage} on the wall`
        : "On the outside wall",
  };
}
