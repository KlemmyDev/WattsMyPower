import { useQuery } from "@tanstack/react-query";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Quiet, WidgetCard } from "~/features/common/widgets/parts";
import type { Choice, Settings, WidgetCtx, WidgetDef, WidgetProps } from "~/features/common/widgets/types";
import { bluelinkQuery, bydQuery, teslaQuery } from "~/features/ev/api";
import { BydPanel } from "~/features/ev/components/BydPanel";
import { EvCharging } from "~/features/ev/components/EvCharging";
import { EvDayChart } from "~/features/ev/components/EvDayChart";
import { EvInOut } from "~/features/ev/components/EvInOut";
import { EvPanel } from "~/features/ev/components/EvPanel";
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

function Summary({ settings }: WidgetProps) {
  const c = useCar(settings);
  if (c.tesla) return <EvPanel v={c.tesla} provider={c.teslaProvider} />;
  if (c.bluelink) return <EvPanel v={c.bluelink} provider={c.bluelinkBrand} brand="bluelink" />;
  if (c.byd) return <BydPanel v={c.byd} />;
  return quiet("Car", "Looking for your car…");
}
function Day({ ctx, settings }: WidgetProps) {
  const c = useCar(settings);
  return c.tesla ? <EvDayChart v={c.tesla} now={ctx.now} /> : quiet("Car's day", "Its day is charted for a Tesla.");
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
    type: "car",
    name: "Car",
    sub: "Its charge, what it's doing, and its controls",
    group: "car",
    icon: "car",
    thumb: { kind: "number", value: "63%", color: COLOR.lilac },
    sizes: size([6, 3], [12, 5], [12, 4]),
    phone: size([4, 4], [4, 7], [4, 5]),
    options: [pick],
    needs: needsCar,
    Component: Summary,
  },
  {
    type: "car-day",
    name: "Car's day",
    sub: "Its charge through the day, and what the dashboard did",
    group: "car",
    icon: "chart",
    thumb: { kind: "line", color: COLOR.lilac },
    sizes: size([6, 5], [12, 8], [12, 6]),
    phone: size([4, 6], [4, 9], [4, 7]),
    options: [pick],
    needs: needsCar,
    Component: Day,
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
