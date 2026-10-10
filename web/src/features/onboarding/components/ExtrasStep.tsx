import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import type { IconName } from "~/features/common/ui/components/Icon";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { PAINT } from "~/features/car/utils";
import { bydQuery, teslaQuery } from "~/features/ev/api";
import { gridQuery } from "~/features/grid/api";
import { homeQuery } from "~/features/home/api";
import { useInverters } from "~/features/integrations/hooks";
import { onboardingQuery } from "~/features/onboarding/api";
import { StepBody, StepFooter, StepIntro, type StepProps } from "~/features/onboarding/components/StepParts";
import { useMarkOnboarding } from "~/features/onboarding/hooks/useMarkOnboarding";
import type { ExtraId } from "~/features/onboarding/types";
import { HouseScene, type HouseFlows } from "~/features/overview/components/HouseScene";
import { houseOptions } from "~/features/overview/utils/house/options";

export type Extra = {
  id: ExtraId;
  title: string;
  sub: string;
  icon: IconName;
  color: string;
  /** Where it's connected, from the guide's finish. */
  href: string;
  /** Its button there. */
  connect: string;
};

/** What else WattsMyPower can read, each picked here and offered on the finish to connect. */
export const EXTRAS: Extra[] = [
  {
    id: "ev",
    title: "An electric car",
    sub: "A Tesla or BYD: its charge, and charging it from spare solar",
    icon: "car",
    color: COLOR.battery,
    href: "/integrations/ev",
    connect: "Connect your car",
  },
  {
    id: "home",
    title: "Smart plugs and appliances",
    sub: "What each room and appliance uses, on the Home page",
    icon: "plug",
    color: COLOR.good,
    href: "/integrations/home",
    connect: "Connect your smart home",
  },
  {
    id: "inverter",
    title: "A second inverter",
    sub: "More panels on their own inverter, beside your hybrid",
    icon: "sun",
    color: COLOR.solar,
    href: "/integrations/inverters",
    connect: "Add the second inverter",
  },
  {
    id: "grid",
    title: "Power outages near you",
    sub: "From your network, with weather and fire warnings",
    icon: "grid",
    color: COLOR.warn,
    href: "/integrations/grid",
    connect: "Follow outages near you",
  },
];

/** Which extras are already connected, so they're shown as such rather than offered. */
export function useConnectedExtras(): Record<ExtraId, boolean> {
  const tesla = useQuery(teslaQuery).data;
  const byd = useQuery(bydQuery).data;
  const home = useQuery(homeQuery).data;
  const grid = useQuery(gridQuery).data;
  const { inverters } = useInverters();
  const out = grid?.outages;
  return {
    ev: !!tesla?.connected || !!byd?.connected,
    home: !!home?.integrations.some((i) => i.account),
    inverter: inverters.length > 1,
    grid: !!(out?.networks?.length || out?.network),
  };
}

/** The house in the sun, with a car charging in the driveway (in view, not hidden in a garage) once one's picked. */
const FLOWS: HouseFlows = { pv: 5.4, grid: -0.6, bat: 1.4, soc: 0.7, tesla: 0, conn: false };

/**
 * The last step: what else is at the place (a car, smart plugs, a second inverter) or wanted (outages near it), as
 * tiles to tick. Nothing's connected here (the dashboard's pages aren't open until the guide's done): the picks are
 * kept, and the finish offers connecting each. Ones already connected say so. The house is drawn above them as chosen,
 * a car pulling in when one's picked.
 */
export function ExtrasStep({ nav }: StepProps) {
  const { data: onboarding } = useQuery(onboardingQuery);
  const mark = useMarkOnboarding();
  const system = useSystem();
  const connected = useConnectedExtras();
  const [picked, setPicked] = useState<Set<ExtraId>>(() => new Set(onboarding?.extras ?? []));
  const toggle = (id: ExtraId) =>
    setPicked((p) => {
      const next = new Set(p);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const car = picked.has("ev") || connected.ev;
  const house = houseOptions(system, car ? ["outside"] : []);
  const chosen = EXTRAS.filter((e) => picked.has(e.id) && !connected[e.id]);
  return (
    <>
      <StepIntro nav={nav} title="Anything else at your place?">
        WattsMyPower can read more than your inverter. Tick what you have, and the last page links straight to
        connecting each.
      </StepIntro>
      <StepBody>
        <div className="@container">
          <div className="grid grid-cols-1 items-start gap-5 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="relative aspect-[2/1] w-full overflow-hidden rounded-2xl bg-[#dcebff] @4xl:sticky @4xl:top-6 light:outline light:outline-line-subtle">
              <HouseScene
                flows={{ ...FLOWS, tesla: car ? 7.2 : 0 }}
                sky="sunny"
                house={house}
                cars={
                  car
                    ? [{ body: "modelY", paint: PAINT.white.hex, label: "Your car", href: "/ev", charging: true }]
                    : []
                }
              />
            </div>
            <div
              role="group"
              aria-label="What else you have"
              className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @4xl:grid-cols-1 @6xl:grid-cols-2"
            >
              {EXTRAS.map((e, k) => {
                const already = connected[e.id];
                const on = already || picked.has(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    aria-pressed={on}
                    disabled={already}
                    onClick={() => toggle(e.id)}
                    className={cn(
                      "relative flex min-w-0 animate-rise items-start gap-3.5 rounded-2xl border p-4 pr-12 text-left transition-[border-color,background-color,transform] duration-200 active:scale-[0.98] disabled:cursor-default disabled:active:scale-100",
                      on ? "border-transparent" : "border-line-subtle bg-canvas/60 hover:border-line light:bg-canvas",
                    )}
                    style={{
                      animationDelay: `${k * 60}ms`,
                      ...(on ? { background: alpha(e.color, 0.12), boxShadow: `inset 0 0 0 2px ${e.color}` } : {}),
                    }}
                  >
                    <span
                      aria-hidden
                      className="flex size-10 flex-none items-center justify-center rounded-full"
                      style={{ background: alpha(e.color, 0.16), color: e.color }}
                    >
                      <Icon name={e.icon} size={19} />
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[15px] font-semibold">{e.title}</span>
                      <span className="text-[13px] leading-5 text-pretty text-ink-muted">
                        {already ? "Already connected" : e.sub}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "absolute top-4 right-4 flex size-6 items-center justify-center rounded-full border transition-colors duration-200",
                        on ? "border-transparent" : "border-line",
                      )}
                      style={on ? { background: e.color, color: "var(--color-canvas)" } : undefined}
                    >
                      {on && <Icon name="check" size={14} className="animate-spring-in" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </StepBody>
      <StepFooter
        nav={nav}
        label={
          chosen.length ? `Finish and connect ${chosen.length === 1 ? "it" : `these ${chosen.length}`}` : undefined
        }
        onClick={() => {
          mark.mutate({ extras: [...picked] });
          nav.done();
        }}
      />
    </>
  );
}
