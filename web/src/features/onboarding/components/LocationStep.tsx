import { locationLabel } from "~/features/common/energy/utils";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Icon } from "~/features/common/ui/components/Icon";
import { StepBody, StepFooter, StepIntro, type StepProps } from "~/features/onboarding/components/StepParts";
import { DaylightVisual } from "~/features/settings/components/DaylightVisual";
import { LocationForm } from "~/features/settings/components/LocationForm";

/**
 * Step 4: where the panels are, for the solar forecast. The search on one side, and on the other the place's daylight
 * (today's sun and the year's), which appears once a place is chosen and moves with it when it changes.
 */
export function LocationStep({ nav }: StepProps) {
  const system = useSystem();
  const lat = system?.latitude ?? null;
  const lon = system?.longitude ?? null;
  const set = lat != null && lon != null && (lat !== 0 || lon !== 0);
  return (
    <>
      <StepIntro nav={nav} title="Where you live">
        The forecast uses the weather where your panels are to predict tomorrow's solar. Search for your suburb.
      </StepIntro>
      <StepBody>
        <div className="@container">
          <div className="grid grid-cols-1 items-start gap-5 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-5">
              <div className="flex items-center gap-3.5 rounded-2xl bg-canvas/60 px-4 py-3.5 light:bg-canvas">
                <span
                  className="flex size-9 flex-none items-center justify-center rounded-full"
                  style={{ background: alpha(COLOR.teal, 0.16), color: COLOR.teal }}
                >
                  <Icon name="pin" size={17} />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-xs text-ink-muted">{set ? "Your panels are in" : "No location yet"}</span>
                  <span className="truncate text-[15px] font-semibold">
                    {set ? locationLabel(system) : "No forecast, outages or warnings until it's set"}
                  </span>
                </span>
              </div>
              {/* Started afresh when the place changes, so it shows the new one. */}
              <LocationForm key={`${lat},${lon}`} system={system} autoFocus={false} className="pl-0" />
            </div>
            <div className="flex min-w-0 flex-col gap-5 rounded-2xl bg-canvas/60 p-5 light:bg-canvas">
              {set ? (
                <div key={`${lat},${lon}`} className="flex animate-rise flex-col gap-5">
                  <DaylightVisual lat={lat} lon={lon} />
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                  <span
                    className="flex size-14 animate-pulse-soft items-center justify-center rounded-full"
                    style={{ background: alpha(COLOR.solar, 0.14), color: COLOR.solar }}
                  >
                    <Icon name="sun" size={26} />
                  </span>
                  <span className="max-w-[260px] text-[13px] leading-5 text-pretty text-ink-muted">
                    Choose your suburb to see its daylight: today's sun, and how the days grow and shrink through the
                    year.
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </StepBody>
      <StepFooter nav={nav} disabled={!set} />
    </>
  );
}
