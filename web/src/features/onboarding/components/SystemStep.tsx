import { useQuery } from "@tanstack/react-query";
import type { SystemInfo } from "~/features/common/live/types";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { inverterName } from "~/features/common/live/utils";
import { HelpText } from "~/features/common/ui/components/Field";
import { onboardingQuery } from "~/features/onboarding/api";
import { StepBody, StepFooter, StepIntro, type StepProps } from "~/features/onboarding/components/StepParts";
import {
  diagramFigures,
  SystemDetailRows,
  useSystemDetails,
} from "~/features/settings/components/SolarBatterySettings";
import { SystemDiagram } from "~/features/settings/components/SystemDiagram";

/**
 * Step 2: what the inverter can't report, chiefly the size of the solar array. Until it's entered the app
 * runs on a 6.6 kW default, which caps the forecast well under a bigger array's output, so the field starts
 * empty here (unless this step was already done) rather than looking like it's set. The system's diagram sits beside
 * the figures and redraws as they're typed. Continue saves and moves on.
 */
export function SystemStep({ nav }: StepProps) {
  const system = useSystem();
  return (
    <>
      <StepIntro nav={nav} title="Your system">
        A few details your inverter can't tell us. The solar forecast and the battery's plan start from these.
      </StepIntro>
      {/* Mounted once the status has loaded, so the fields start from the saved values. */}
      {system ? <Details system={system} nav={nav} /> : <StepFooter nav={nav} disabled />}
    </>
  );
}

function Details({ system, nav }: { system: SystemInfo; nav: StepProps["nav"] }) {
  const { data: onboarding } = useQuery(onboardingQuery);
  const form = useSystemDetails(system, onboarding?.steps.system === "done" ? [] : ["pv_kw"]);
  // The array as typed: blank here is "not set", not the 6.6 kW default in use until it is.
  const pv = form.values.pv_kw.trim() === "" ? null : Number(form.values.pv_kw) || null;
  const reported = [
    system.model && `${inverterName(system)}${system.nominal_kw ? `, a ${system.nominal_kw} kW inverter` : ""}`,
    system.inverter_battery_kwh && `a ${system.inverter_battery_kwh} kWh battery`,
  ].filter(Boolean);
  return (
    <>
      <StepBody>
        <div className="@container">
          <div className="grid grid-cols-1 items-start gap-5 @4xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-3 rounded-2xl bg-canvas/60 p-4 light:bg-canvas">
              <div className="mx-auto w-full max-w-[600px] @4xl:max-w-none">
                <SystemDiagram system={system} figures={{ ...diagramFigures(system, form), pvKw: pv }} />
              </div>
              {reported.length > 0 && (
                <p className="m-0 px-1 text-[13px] leading-5 text-pretty text-ink-muted">
                  Your inverter reports <b className="font-semibold text-ink">{reported.join(" with ")}</b>. Panels are
                  often sized bigger than the inverter, so check your installer's paperwork for the array size.
                </p>
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <SystemDetailRows system={system} form={form} />
              <HelpText tone="bad" role="alert">
                {form.error}
              </HelpText>
            </div>
          </div>
        </div>
      </StepBody>
      <StepFooter
        nav={nav}
        label={form.pending ? "Saving…" : undefined}
        disabled={form.pending}
        onClick={() => form.submit(nav.done)}
      />
    </>
  );
}
