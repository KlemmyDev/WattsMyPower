import { COLOR } from "~/features/common/theme/utils/colors";
import { liveWeather } from "~/features/common/weather/utils";
import { Quiet, WidgetCard } from "~/features/common/widgets/parts";
import type { WidgetDef, WidgetProps } from "~/features/common/widgets/types";
import { WeatherAhead, WeatherLine } from "~/features/overview/components/PowerFlowHero";

/**
 * The weather, as a widget: the forecast card the power flow's weather opens to, the sky now over the hours ahead, as
 * many of them as its width has room for.
 */
function Weather({ ctx, w, screen }: WidgetProps) {
  const wx = ctx.p ? liveWeather(ctx.p, ctx.f, ctx.now, !!ctx.s?.temp_unit_f) : null;
  const count = screen === "phone" ? 4 : Math.max(3, Math.min(11, Math.round(w * 1.6) - 1));
  return (
    <WidgetCard
      title={
        wx ? (
          <span className="flex items-center gap-1.5 text-[15px] whitespace-nowrap">
            <WeatherLine wx={wx} size={18} />
          </span>
        ) : (
          "Weather"
        )
      }
    >
      {ctx.f?.hours.length ? (
        <div className="flex flex-col gap-3.5">
          <WeatherAhead f={ctx.f} s={ctx.s} now={ctx.now} count={count} />
        </div>
      ) : (
        <Quiet>{ctx.f === null ? "The forecast isn't on, or can't be reached." : "Reading the forecast…"}</Quiet>
      )}
    </WidgetCard>
  );
}

export const widgets: WidgetDef[] = [
  {
    type: "weather",
    name: "Weather",
    sub: "The sky now, and the hours ahead",
    group: "weather",
    icon: "cloudSun",
    thumb: { kind: "number", value: "27°", color: COLOR.solar },
    sizes: { min: [3, 4], max: [12, 5], default: [4, 4] },
    phone: { min: [4, 4], max: [4, 5], default: [4, 4] },
    Component: Weather,
  },
];
