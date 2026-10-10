import { noBattery } from "~/features/battery/utils";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import type { SystemInfo } from "~/features/common/live/types";
import { HelpText } from "~/features/common/ui/components/Field";
import { StepBody, StepFooter, StepIntro, type StepProps } from "~/features/onboarding/components/StepParts";
import { CostVisual } from "~/features/settings/components/CostVisual";
import { useOwnershipForm } from "~/features/settings/components/OwnershipSettings";
import { OptionList } from "~/features/settings/components/SettingsSection";

/**
 * Step 7, optional: what the system cost and when it went in, for when it pays for itself (on Bills), and the battery's
 * warranty (on Battery), as Settings → Cost and warranty has them. Beside them, the payback ring and the system's life
 * so far, redrawn as they're typed. The step's own button saves them.
 */
export function CostStep({ nav }: StepProps) {
  const system = useSystem();
  return (
    <>
      <StepIntro nav={nav} title="Cost and payback">
        Optional, but satisfying: with what your system cost, Bills shows how much of it has paid back and when it pays
        for itself. Your installer's invoice has the figures.
      </StepIntro>
      {/* Mounted once the status has loaded, so the fields start from the saved values. */}
      {system ? <Cost system={system} nav={nav} /> : <StepFooter nav={nav} disabled />}
    </>
  );
}

function Cost({ system, nav }: { system: SystemInfo; nav: StepProps["nav"] }) {
  const form = useOwnershipForm(system);
  const battery = !noBattery(system);
  return (
    <>
      <StepBody>
        <div className="@container">
          <div className="grid grid-cols-1 items-start gap-5 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-5 rounded-2xl bg-canvas/60 p-5 @4xl:sticky @4xl:top-6 light:bg-canvas">
              <span className="text-[15px] font-semibold">Return on your system</span>
              <CostVisual figures={form.figures} />
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              <div className="flex flex-col gap-2.5">
                <span className="text-[15px] font-semibold">The system</span>
                <OptionList>
                  {form.row("system_cost")}
                  {form.row("system_installed")}
                </OptionList>
              </div>
              {battery && (
                <div className="flex flex-col gap-2.5">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[15px] font-semibold">The battery</span>
                    <span className="text-[13px] leading-5 text-ink-muted">
                      For how much of its warranty is used, on Battery.
                    </span>
                  </div>
                  <OptionList>
                    {form.row("battery_installed")}
                    {form.row("battery_warranty_years")}
                    {form.row("battery_warranty_mwh")}
                  </OptionList>
                </div>
              )}
              <HelpText tone="bad" role="alert">
                {form.error}
              </HelpText>
            </div>
          </div>
        </div>
      </StepBody>
      <StepFooter
        nav={nav}
        label={form.pending ? "Saving…" : form.dirty ? "Save and continue" : undefined}
        disabled={form.pending}
        onClick={form.dirty ? () => form.submit(nav.done) : nav.done}
      />
    </>
  );
}
