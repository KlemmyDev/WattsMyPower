import { useState, type ReactNode } from "react";
import { useMedia } from "~/features/common/layout/hooks";
import type { SystemInfo } from "~/features/common/live/types";
import { useLive } from "~/features/common/live/hooks/useLive";
import { Segmented } from "~/features/common/ui/components/Segmented";
import {
  CarSpaces,
  GardenRows,
  HousePreview,
  KindTiles,
  PanelsRow,
  RoofSwatches,
  SaveNote,
  StoreyTiles,
  UnitRows,
  unitsSub,
  unitsTitle,
  useHouseEditor,
  WallSwatches,
  type HouseEditor,
} from "~/features/settings/components/HouseFields";
import { HousePhone } from "~/features/settings/components/HousePhone";
import { OptionList, SettingsSection } from "~/features/settings/components/SettingsSection";
import { SettingsPageHeader } from "~/features/settings/components/SubPageHeader";

/** A phone: the house with a dot on each part, rather than the choices beside it. */
const PHONE = "(max-width: 639px)";

type Group = "kind" | "size" | "look" | "outside" | "units";

const GROUPS: { value: Group; label: string }[] = [
  { value: "kind", label: "Kind" },
  { value: "size", label: "Size" },
  { value: "look", label: "Look" },
  { value: "outside", label: "Outside" },
  { value: "units", label: "Equipment" },
];

/** A group of choices: its title, a line under it, and the choices. */
function groupOf(e: HouseEditor, g: Group): { title: string; sub: string; body: ReactNode } {
  switch (g) {
    case "kind":
      return { title: "Kind of house", sub: "Its shape: walls, roof, windows and porch.", body: <KindTiles e={e} /> };
    case "size":
      return {
        title: "Size",
        sub: "How many storeys, and the garage or carport beside it.",
        body: (
          <>
            <StoreyTiles e={e} />
            <CarSpaces e={e} />
          </>
        ),
      };
    case "look":
      return {
        title: "Look",
        sub: "The walls and the roof. A is the kind of house's own.",
        body: (
          <>
            <WallSwatches e={e} />
            <RoofSwatches e={e} />
          </>
        ),
      };
    case "outside":
      return {
        title: "Outside",
        sub: "The panels on the roof, and the garden.",
        body: (
          <OptionList>
            <PanelsRow e={e} />
            <GardenRows e={e} />
          </OptionList>
        ),
      };
    case "units":
      return { title: unitsTitle(e), sub: unitsSub(e), body: <UnitRows e={e} /> };
  }
}

/**
 * Settings → Your house: how the Overview draws the house, with the house as it's set always in view while it's
 * changed. On a phone, the house with a dot on each part to tap (HousePhone).
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
      {live && <HouseEditorView system={live.system} />}
    </>
  );
}

function HouseEditorView({ system }: { system: SystemInfo }) {
  const e = useHouseEditor(system);
  const phone = useMedia(PHONE);
  return phone ? <HousePhone e={e} /> : <HouseWide e={e} />;
}

/**
 * From a tablet up: the house on the left, staying where it is while the page scrolls, and its choices on the right,
 * a group at a time (Kind, Size, Look, Outside, Equipment). Where there isn't room side by side, the house is across
 * the top instead, staying there as the choices under it scroll.
 */
function HouseWide({ e }: { e: HouseEditor }) {
  const [group, setGroup] = useState<Group>("kind");
  const g = groupOf(e, group);
  return (
    <div className="@container">
      <div className="grid grid-cols-1 items-start gap-5 @4xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,1fr)]">
        {/* Stacked, it's kept short enough to leave room for the choices under it, without cropping the house. */}
        <div className="sticky top-[76px] z-10 flex flex-col gap-3 md:top-6">
          <HousePreview
            e={e}
            className="mx-auto aspect-[2/1] max-w-[calc(44dvh*2)] shadow-pill @4xl:aspect-[16/9] @4xl:max-w-none @4xl:shadow-none"
          />
          <SaveNote e={e} className="hidden @4xl:block" />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Segmented
            role="tablist"
            label="Choices"
            options={GROUPS}
            value={group}
            onChange={setGroup}
            className="w-full"
            buttonClassName="flex-1 justify-center px-2 text-[13px]"
          />
          <div role="tabpanel" aria-label={g.title}>
            <SettingsSection key={group} id={`h-house-${group}`} title={g.title} sub={g.sub} className="animate-fade">
              {g.body}
            </SettingsSection>
          </div>
        </div>
      </div>
    </div>
  );
}
