import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "~/features/common/ui/components/Button";
import { integrationsQuery } from "~/features/integrations/api";
import { ConnectInverter } from "~/features/integrations/components/ConnectInverter";
import { ConnectedInverters } from "~/features/integrations/components/ConnectedInverters";
import { StepFooter, StepIntro, type StepProps } from "~/features/onboarding/components/StepParts";

/** Step 1: find the main inverter and connect it, then (optionally) a second one. */
export function InverterStep({ nav }: StepProps) {
  const { data } = useQuery(integrationsQuery);
  const [second, setSecond] = useState(false);
  const devices = data?.devices ?? [];
  const hasHybrid = devices.some((d) => d.role === "hybrid");
  const hasPv2 = devices.some((d) => d.role === "pv2");
  const canConnect = !!data?.available && !data.read_only;

  return (
    <>
      <StepIntro nav={nav} title="Connect your inverter">
        WattsMyPower reads your inverter every minute over your home network. Find it with a quick scan, or enter its
        address.
      </StepIntro>
      <div className="border-t border-line-subtle empty:hidden">
        <ConnectedInverters />
      </div>
      {canConnect && hasHybrid && !hasPv2 && (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line-subtle px-6 py-5">
          <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
            <span className="text-[15px] font-semibold">Got a second solar inverter?</span>
            <span className="text-[13px] text-ink-muted">
              Optional. Connect it too if the house has a second, separate solar system.
            </span>
          </div>
          <Button variant="outline" onClick={() => setSecond((o) => !o)} aria-expanded={second}>
            {second ? "Not now" : "Connect it"}
          </Button>
        </div>
      )}
      {canConnect && (!hasHybrid || second) && (
        <ConnectInverter overview={data} onConnected={() => setSecond(false)} className="border-t border-line-subtle" />
      )}
      <StepFooter nav={nav} disabled={!hasHybrid} />
    </>
  );
}
