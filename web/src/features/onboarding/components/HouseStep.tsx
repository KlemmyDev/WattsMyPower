import { useState } from "react";
import { AuthScene } from "~/features/auth/components/AuthScene";
import { useMedia } from "~/features/common/layout/hooks";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import type { SystemInfo } from "~/features/common/live/types";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { StepBody, StepFooter, StepIntro, type StepProps } from "~/features/onboarding/components/StepParts";
import type { HouseOptions, HouseStyle } from "~/features/overview/utils/house/layout";
import { SaveNote, useHouseEditor, type HouseEditor } from "~/features/settings/components/HouseFields";
import { HousePhone } from "~/features/settings/components/HousePhone";
import { GROUPS, groupOf, PHONE, type Group } from "~/features/settings/components/HouseSettings";

/** Each kind of house as it reads in a sentence. */
const NOUNS: Record<HouseStyle, string> = {
  estate: "brick home",
  brick: "brick-and-tile home",
  modern: "modern home",
  coastal: "coastal home",
  queenslander: "Queenslander",
  federation: "Federation home",
  bungalow: "Californian bungalow",
  farmhouse: "farmhouse",
  townhouse: "townhouse",
};

/** "A double-storey Queenslander with a single carport". */
function describe(h: HouseOptions): string {
  const cars = h.garage ? ` with a ${h.garage === 2 ? "double" : "single"} ${h.garageKind}` : "";
  return `A ${h.storeys === 2 ? "double" : "single"}-storey ${NOUNS[h.style]}${cars}`;
}

/**
 * Step 3: the house the Overview draws, with Settings → Your house's choices. From a tablet up, the picture on one side
 * (by day or night, the power moving through it), kept in view, redraws as the choices are made on the other, a group
 * at a time. On a phone, Settings' own layout: the house with a dot on each part to tap. Each choice saves as it's
 * made, so Continue just moves on.
 */
export function HouseStep({ nav }: StepProps) {
  const system = useSystem();
  return (
    <>
      <StepIntro nav={nav} title="Your house">
        The Overview draws your home with the power moving through it. Pick what's closest to yours: it's only the
        picture, nothing's worked out from it.
      </StepIntro>
      {/* Mounted once the status has loaded, so the choices start from the saved ones. */}
      {system ? <House system={system} /> : null}
      <StepFooter nav={nav} disabled={!system} />
    </>
  );
}

function House({ system }: { system: SystemInfo }) {
  const e = useHouseEditor(system);
  const phone = useMedia(PHONE);
  return <StepBody>{phone ? <HousePhone e={e} /> : <HouseWide e={e} />}</StepBody>;
}

function HouseWide({ e }: { e: HouseEditor }) {
  const [group, setGroup] = useState<Group>("kind");
  const g = groupOf(e, group);
  return (
    <div className="@container">
      <div className="grid grid-cols-1 items-start gap-6 @4xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3 @4xl:sticky @4xl:top-6">
          <AuthScene house={e.house} className="rounded-2xl max-md:rounded-2xl" />
          {/* Keyed so a new choice rises in. */}
          <p key={describe(e.house)} className="m-0 animate-rise px-1 text-[15px] font-medium text-pretty">
            {describe(e.house)}
            <span className="font-normal text-ink-muted"> · try the sun and moon to see it by day and by night.</span>
          </p>
          <SaveNote e={e} className="m-0" />
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
          <div
            key={group}
            role="tabpanel"
            aria-labelledby={`h-step-house-${group}`}
            className="flex animate-fade flex-col gap-4"
          >
            <div className="flex flex-col gap-0.5">
              <span id={`h-step-house-${group}`} className="text-[15px] font-semibold">
                {g.title}
              </span>
              <span className="text-[13px] leading-5 text-pretty text-ink-muted">{g.sub}</span>
            </div>
            {g.body}
          </div>
        </div>
      </div>
    </div>
  );
}
