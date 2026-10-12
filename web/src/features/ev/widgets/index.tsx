import { useQuery } from "@tanstack/react-query";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Quiet, WidgetCard } from "~/features/common/widgets/parts";
import type { Choice, Settings, WidgetCtx, WidgetDef, WidgetProps } from "~/features/common/widgets/types";
import { bluelinkQuery, bydQuery, teslaQuery } from "~/features/ev/api";
import { BydHero } from "~/features/ev/components/BydHero";
import { EvCharging } from "~/features/ev/components/EvCharging";
import { EvHero } from "~/features/ev/components/EvHero";
import { EvInOut } from "~/features/ev/components/EvInOut";
import { EvNow, evRows, evShow } from "~/features/ev/components/EvNow";
import { carTitle } from "~/features/ev/utils";

const size = (min: [number, number], max: [number, number], d: [number, number]) => ({ min, max, default: d });

const carChoices = (ctx: WidgetCtx): Choice[] => ctx.cars.map((c) => ({ value: c.vin, label: c.name ?? carTitle(c) }));
const needsCar = (ctx: WidgetCtx) => (ctx.cars.length ? null : "Connect a car first");
const pick = {
  key: "car",
  label: "Car",
  kind: "select" as const,
  choices: carChoices,
  default: (ctx: WidgetCtx) => carChoices(ctx)[0]?.value ?? "",
};

/** The car a widget is set to (else the first), read as the EV page reads it: a Tesla, a Hyundai or Kia, or a BYD. */
function useCar(settings: Settings) {
  const tesla = useQuery(teslaQuery).data;
  const bluelink = useQuery(bluelinkQuery).data;
  const byd = useQuery(bydQuery).data;
  const teslas = tesla?.connected ? tesla.vehicles : [];
  const hks = bluelink?.connected ? bluelink.vehicles : [];
  const byds = byd?.connected ? byd.vehicles : [];
  const vin = settings.car as string | undefined;
  const find = <T extends { vin: string }>(list: T[]) => list.find((v) => !vin || v.vin === vin);
  return {
    tesla: find(teslas),
    teslaProvider: tesla?.provider ?? null,
    bluelink: find(hks),
    bluelinkBrand: (bluelink?.brand === "kia" ? "kia" : "hyundai") as "kia" | "hyundai",
    byd: find(byds),
  };
}

const quiet = (title: string, text: string) => (
  <WidgetCard title={title} icon="car">
    <Quiet>{text}</Quiet>
  </WidgetCard>
);

/** The car's hero: at a glance (`compact`, opening its page), or today with its day charted and its limit to drag. */
function Hero({ ctx, settings, chart }: WidgetProps & { chart: boolean }) {
  const c = useCar(settings);
  const alone = ctx.cars.length === 1;
  if (c.tesla)
    return <EvHero v={c.tesla} provider={c.teslaProvider} alone={alone} now={ctx.now} chart={chart} compact={!chart} />;
  if (c.bluelink)
    return (
      <EvHero
        v={c.bluelink}
        provider={c.bluelinkBrand}
        brand="bluelink"
        alone={alone}
        now={ctx.now}
        chart={false}
        compact={!chart}
      />
    );
  if (c.byd) return <BydHero v={c.byd} compact={!chart} />;
  return quiet("Car", "Looking for your car…");
}
function Charging({ settings }: WidgetProps) {
  const c = useCar(settings);
  if (c.tesla) return <EvCharging v={c.tesla} />;
  if (c.bluelink) return <EvCharging v={c.bluelink} brand="bluelink" />;
  return quiet("Charging", "Charging from spare solar is for a Tesla, Hyundai or Kia.");
}
function InOut({ ctx, settings }: WidgetProps) {
  const c = useCar(settings);
  return c.tesla ? <EvInOut vin={c.tesla.vin} now={ctx.now} /> : quiet("In and out", "Kept for a Tesla.");
}

/** The EV page's cards, as widgets, each for the car chosen. */
export const widgets: WidgetDef[] = [
  {
    type: "ev-now",
    name: "EV",
    sub: "Any connected car: its charge, what it's doing, and what it charged today",
    group: "car",
    icon: "car",
    thumb: { kind: "number", value: "64%", color: COLOR.lilac },
    sizes: size([2, 2], [8, 6], [4, 4]),
    phone: size([2, 2], [4, 6], [4, 4]),
    rowsFor: (st, _screen, w) => evRows(evShow(st), w),
    options: [
      pick,
      { key: "doing", label: "What it's doing", sub: "In a sentence", kind: "toggle", default: true, section: "Show" },
      {
        key: "today",
        label: "Charged today",
        sub: "And how it's set to charge",
        kind: "toggle",
        default: true,
        section: "Figures, given room",
      },
    ],
    needs: needsCar,
    Component: ({ ctx, settings, w, h }: WidgetProps) => (
      <EvNow
        car={ctx.cars.find((c) => c.vin === settings.car) ?? ctx.cars[0]}
        cars={ctx.cars.length}
        now={ctx.now}
        w={w}
        h={h}
        show={evShow(settings)}
      />
    ),
  },
  {
    type: "car",
    name: "Car at a glance",
    sub: "Its charge, what it's doing now, and what it charged today",
    group: "car",
    icon: "car",
    thumb: { kind: "number", value: "63%", color: COLOR.danger },
    sizes: size([6, 3], [12, 5], [12, 4]),
    phone: size([4, 6], [4, 8], [4, 7]),
    options: [pick],
    needs: needsCar,
    Component: (props: WidgetProps) => <Hero {...props} chart={false} />,
  },
  {
    type: "car-day",
    name: "Car today",
    sub: "Its charge and now, its limit to drag, and its day charted with what the dashboard did",
    group: "car",
    icon: "chart",
    thumb: { kind: "line", color: COLOR.danger },
    sizes: size([6, 9], [12, 12], [12, 10]),
    phone: size([4, 13], [4, 16], [4, 14]),
    options: [pick],
    needs: needsCar,
    Component: (props: WidgetProps) => <Hero {...props} chart />,
  },
  {
    type: "car-charging",
    name: "Charging from solar",
    sub: "How it charges, and the spare there is for it",
    group: "car",
    icon: "sun",
    thumb: { kind: "rows" },
    sizes: size([5, 5], [12, 9], [6, 7]),
    phone: size([4, 7], [4, 10], [4, 8]),
    options: [pick],
    needs: needsCar,
    Component: Charging,
  },
  {
    type: "car-in-out",
    name: "Car in and out",
    sub: "Charges at home, and what it used while away",
    group: "car",
    icon: "car",
    thumb: { kind: "bars", color: COLOR.lilac },
    sizes: size([5, 5], [12, 12], [6, 8]),
    phone: size([4, 7], [4, 12], [4, 9]),
    options: [pick],
    needs: needsCar,
    Component: InOut,
  },
];
