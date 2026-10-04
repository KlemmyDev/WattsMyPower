import { useQuery } from "@tanstack/react-query";
import type { SystemInfo } from "~/features/common/live/types";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { inverterName } from "~/features/common/live/utils";
import { HelpText } from "~/features/common/ui/components/Field";
import { onboardingQuery } from "~/features/onboarding/api";
import { StepBody, StepFooter, StepIntro, type StepProps } from "~/features/onboarding/components/StepParts";
import { SystemDetailsFields, useSystemDetails } from "~/features/settings/components/SystemSettings";

/**
 * Step 2: what the inverter can't report, chiefly the size of the solar array. Until it's entered the app
 * runs on a 6.6 kW default, which caps the forecast well under a bigger array's output, so the field starts
 * empty here (unless this step was already done) rather than looking like it's set. Continue saves and moves on.
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
  const reported = [
    system.model && `${inverterName(system)}${system.nominal_kw ? `, a ${system.nominal_kw} kW inverter` : ""}`,
    system.inverter_battery_kwh && `a ${system.inverter_battery_kwh} kWh battery`,
  ].filter(Boolean);
  return (
    <>
      <StepBody>
        {reported.length > 0 && (
          <div className="rounded-xl bg-canvas px-4 py-3.5 text-sm leading-[22px] text-ink-muted">
            Your inverter reports <b className="font-semibold text-ink">{reported.join(" with ")}</b>. Panels are often
            sized bigger than the inverter, so check your installer's paperwork for the array size.
          </div>
        )}
        <SystemDetailsFields system={system} form={form} />
        <HelpText tone="bad" role="alert">
          {form.error}
        </HelpText>
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
