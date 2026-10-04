import { locationLabel } from "~/features/common/energy/utils";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { StepBody, StepFooter, StepIntro, type StepProps } from "~/features/onboarding/components/StepParts";
import { LocationForm } from "~/features/settings/components/LocationForm";

/** Step 4: where the panels are, for the solar forecast. Choosing a place saves it and moves on. */
export function LocationStep({ nav }: StepProps) {
  const system = useSystem();
  return (
    <>
      <StepIntro nav={nav} title="Where you live">
        The forecast uses the weather where your panels are to predict tomorrow's solar. Search for your suburb.
      </StepIntro>
      <StepBody>
        <div className="rounded-xl bg-canvas px-4 py-3.5 text-sm leading-[22px] text-ink-muted">
          The forecast is for <b className="font-semibold text-ink">{locationLabel(system)}</b> right now.
        </div>
        <LocationForm system={system} onSaved={nav.done} autoFocus={false} className="pl-0" />
      </StepBody>
      <StepFooter nav={nav} />
    </>
  );
}
