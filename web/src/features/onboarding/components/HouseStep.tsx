import type { ReactNode } from "react";
import { AuthScene } from "~/features/auth/components/AuthScene";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import type { SystemInfo } from "~/features/common/live/types";
import { StepBody, StepFooter, StepIntro, type StepProps } from "~/features/onboarding/components/StepParts";
import type { HouseOptions, HouseStyle } from "~/features/overview/utils/house/layout";
import { HOUSE_STYLES, Thumb, UnitPlaces, useHouseChoices } from "~/features/settings/components/HouseSettings";
import { ChoiceTiles } from "~/features/settings/components/SettingsSection";

/** Each style as it reads in a sentence. */
const NOUNS: Record<HouseStyle, string> = {
  estate: "brick home",
  modern: "modern home",
  queenslander: "Queenslander",
  federation: "Federation home",
  farmhouse: "farmhouse",
};

/** "A double-storey Queenslander with a single garage". */
function describe(h: HouseOptions): string {
  const garage = h.garage ? ` with a ${h.garage === 2 ? "double" : "single"} garage` : "";
  return `A ${h.storeys === 2 ? "double" : "single"}-storey ${NOUNS[h.style]}${garage}`;
}

/** One of the step's choices: its name and a line, then the tiles. */
function Choice({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{title}</span>
        {sub && <span className="text-[13px] leading-5 text-pretty text-ink-muted">{sub}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * Step 3: the house the Overview draws, as Settings → Your house has it. The picture on one side (by day or night, the
 * power moving through it) redraws as the style, storeys and garage are picked on the other; with a garage, the
 * inverter and battery can go inside it. Each choice saves as it's made, so Continue just moves on.
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
      {system ? <House system={system} nav={nav} /> : <StepFooter nav={nav} disabled />}
    </>
  );
}

function House({ system, nav }: { system: SystemInfo; nav: StepProps["nav"] }) {
  const choices = useHouseChoices(system);
  const { values, set, house, garage } = choices;
  return (
    <>
      <StepBody>
        <div className="@container">
          <div className="grid grid-cols-1 items-start gap-6 @4xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-3 @4xl:sticky @4xl:top-6">
              <AuthScene house={house} className="rounded-2xl max-md:rounded-2xl" />
              {/* Keyed so a new choice rises in. */}
              <p key={describe(house)} className="m-0 animate-rise px-1 text-[15px] font-medium text-pretty">
                {describe(house)}
                <span className="font-normal text-ink-muted">
                  {" "}
                  · try the sun and moon to see it by day and by night.
                </span>
              </p>
            </div>
            <div className="flex min-w-0 flex-col gap-6">
              <Choice title="Style" sub="The walls, roof and windows.">
                <ChoiceTiles
                  label="Style"
                  min="7.5rem"
                  color={nav.step.color}
                  value={house.style}
                  onChange={(v) => set({ house_style: v })}
                  options={HOUSE_STYLES.map((st) => ({
                    value: st.value,
                    title: st.name,
                    preview: <Thumb house={{ ...house, style: st.value }} />,
                  }))}
                />
              </Choice>
              <div className="grid grid-cols-1 gap-6 @lg:grid-cols-[2fr_3fr] @4xl:grid-cols-1 @6xl:grid-cols-[2fr_3fr]">
                <Choice title="Storeys">
                  <ChoiceTiles
                    label="Storeys"
                    min="6.5rem"
                    color={nav.step.color}
                    value={String(values.house_storeys)}
                    onChange={(v) => set({ house_storeys: +v })}
                    options={[
                      { value: "1", title: "Single", preview: <Thumb house={{ ...house, storeys: 1 }} /> },
                      { value: "2", title: "Double", preview: <Thumb house={{ ...house, storeys: 2 }} /> },
                    ]}
                  />
                </Choice>
                <Choice title="Garage">
                  <ChoiceTiles
                    label="Garage"
                    min="6.5rem"
                    phone={3}
                    color={nav.step.color}
                    value={String(values.garage_spaces)}
                    onChange={(v) => set({ garage_spaces: +v })}
                    options={[
                      { value: "0", title: "None", preview: <Thumb house={{ ...house, garage: 0 }} /> },
                      { value: "1", title: "Single", preview: <Thumb house={{ ...house, garage: 1 }} /> },
                      { value: "2", title: "Double", preview: <Thumb house={{ ...house, garage: 2 }} /> },
                    ]}
                  />
                </Choice>
              </div>
              <Choice
                title={house.batteries.length ? "Inverters and battery" : "Inverters"}
                sub={
                  garage
                    ? "On an outside wall, or in the garage (drawn see-through, so what's inside shows)."
                    : "On the house's outside wall. Add a garage to put any of them inside it."
                }
              >
                <UnitPlaces choices={choices} />
              </Choice>
            </div>
          </div>
        </div>
      </StepBody>
      <StepFooter nav={nav} />
    </>
  );
}
