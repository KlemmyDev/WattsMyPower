import { COLOR } from "~/features/common/theme/utils/colors";
import type { WidgetDef, WidgetProps } from "~/features/common/widgets/types";
import { WeatherNowCard } from "~/features/weather/components/WeatherNowCard";

/** The weather, as a widget. */
export const widgets: WidgetDef[] = [
  {
    type: "weather",
    name: "Weather",
    sub: "The sky now, and the hours ahead",
    group: "weather",
    icon: "cloudSun",
    thumb: { kind: "number", value: "27°", color: COLOR.solar },
    sizes: { min: [2, 2], max: [12, 3], default: [4, 2] },
    phone: { min: [2, 2], max: [4, 3], default: [4, 2] },
    Component: ({ ctx, w }: WidgetProps) => (
      <WeatherNowCard p={ctx.p} s={ctx.s} f={ctx.f} now={ctx.now} hours={w >= 8 ? 8 : w >= 4 ? 5 : 0} />
    ),
  },
];
