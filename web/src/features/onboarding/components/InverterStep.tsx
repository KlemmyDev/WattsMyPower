import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { kW, pct } from "~/features/common/formatting/utils/number";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Button } from "~/features/common/ui/components/Button";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { integrationsQuery } from "~/features/integrations/api";
import { ConnectInverter } from "~/features/integrations/components/ConnectInverter";
import { ConnectedInverters } from "~/features/integrations/components/ConnectedInverters";
import { StepBody, StepFooter, StepIntro, type StepProps } from "~/features/onboarding/components/StepParts";

/**
 * Step 1: find the main inverter and connect it, then (optionally) a second one. Until it's connected, a radar looks
 * for it; once it is, its first readings come in live, to show it's working.
 */
export function InverterStep({ nav }: StepProps) {
  const { data } = useQuery(integrationsQuery);
  const [second, setSecond] = useState(false);
  const devices = data?.devices ?? [];
  const hybrid = devices.find((d) => d.role === "hybrid");
  const hasHybrid = !!hybrid;
  const hasPv2 = devices.some((d) => d.role === "pv2");
  const canConnect = !!data?.available && !data.read_only;

  return (
    <>
      <StepIntro nav={nav} title="Connect your inverter">
        WattsMyPower reads your inverter every minute over your home network. Find it with a quick scan, or enter its
        address.
      </StepIntro>
      {data && (
        <StepBody>{hybrid ? <LiveNow reading={!!hybrid.last_success} /> : canConnect && <Searching />}</StepBody>
      )}
      <div className="border-t border-line-subtle empty:hidden">
        <ConnectedInverters />
      </div>
      {canConnect && hasHybrid && !hasPv2 && (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line-subtle px-7 py-5 max-sm:px-5">
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
        <ConnectInverter
          overview={data}
          onConnected={() => setSecond(false)}
          className="border-t border-line-subtle px-7 max-sm:px-5"
        />
      )}
      <StepFooter nav={nav} disabled={!hasHybrid} />
    </>
  );
}

/** Rings spreading from the house while there's no inverter yet: what the scan below is about to do. */
function Searching() {
  const c = COLOR.brand;
  return (
    <div className="flex items-center gap-5 overflow-hidden rounded-2xl bg-canvas/60 p-5 max-sm:flex-col max-sm:items-start light:bg-canvas">
      <span aria-hidden className="relative flex size-20 flex-none items-center justify-center">
        {[0, 0.8, 1.6].map((d) => (
          <span
            key={d}
            className="radar-ripple absolute inset-5 rounded-full border-2"
            style={{ borderColor: alpha(c, 0.5), animationDelay: `${d}s` }}
          />
        ))}
        <span
          className="relative flex size-11 items-center justify-center rounded-full"
          style={{ background: alpha(c, 0.18), color: c }}
        >
          <Icon name="wifi" size={20} />
        </span>
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[15px] font-semibold">Let's find it</span>
        <span className="text-[13px] leading-5 text-pretty text-ink-muted">
          The scan knocks on every address on your network and asks what's there, which takes about a minute. The
          inverter's Wi-Fi dongle needs to be on the same network as this server.
        </span>
      </div>
    </div>
  );
}

/** The inverter's readings, live: proof it's connected, with a dot that pulses. Dashes until its first reading. */
function LiveNow({ reading }: { reading: boolean }) {
  const live = useSnapshot();
  // Until the new inverter answers, the figures are from before it (or none).
  const p = reading ? live : null;
  const stats: { icon: IconName; color: string; label: string; value: string }[] = [
    { icon: "sun", color: COLOR.solar, label: "Solar", value: kW(p?.pv_power) },
    { icon: "home", color: COLOR.teal, label: "Home", value: kW(p?.load_power) },
    { icon: "battery", color: COLOR.battery, label: "Battery", value: pct(p?.battery_soc) },
    {
      icon: "grid",
      color: COLOR.grid,
      label: (p?.grid_power ?? 0) < -50 ? "Selling" : (p?.grid_power ?? 0) > 50 ? "Buying" : "Grid",
      value: kW(p?.grid_power == null ? null : Math.abs(p.grid_power)),
    },
  ];
  return (
    <div
      className="flex animate-rise flex-col gap-4 rounded-2xl p-5"
      style={{ background: `linear-gradient(110deg, ${alpha(COLOR.good, 0.12)}, ${alpha(COLOR.good, 0.03)})` }}
    >
      <div className="flex items-center gap-2.5">
        <span className="relative flex size-2.5">
          <span
            className="absolute inset-0 animate-ping rounded-full motion-reduce:hidden"
            style={{ background: COLOR.good }}
          />
          <span className="relative size-2.5 rounded-full" style={{ background: COLOR.good }} />
        </span>
        <span className="text-[15px] font-semibold">{p ? "It's working" : "Connected"}</span>
        <span className="text-[13px] text-ink-muted">
          {p ? "Live from your inverter, right now" : "Waiting for the first reading…"}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-3 max-sm:grid-cols-2">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center gap-3 rounded-xl bg-surface/70 px-3 py-2.5">
            <span
              className="flex size-8 flex-none items-center justify-center rounded-full"
              style={{ background: alpha(s.color, 0.16), color: s.color }}
            >
              <Icon name={s.icon} size={16} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-xs text-ink-muted">{s.label}</span>
              <span className="truncate text-[17px] font-light tabular-nums">{s.value}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
