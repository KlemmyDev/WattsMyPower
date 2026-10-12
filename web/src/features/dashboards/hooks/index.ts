import { useQuery } from "@tanstack/react-query";
import { useAmberPrices } from "~/features/amber/hooks";
import { useNoBattery } from "~/features/battery/hooks";
import { useLive } from "~/features/common/live/hooks/useLive";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { useNow } from "~/features/common/time/hooks";
import { useForecast } from "~/features/common/weather/hooks";
import type { WidgetCtx } from "~/features/common/widgets/types";
import { homeQuery } from "~/features/home/api";

/** What the widgets draw on, read once for the page. */
export function useWidgetCtx(): WidgetCtx {
  const now = useNow();
  const p = useSnapshot();
  const s = useSystem();
  const f = useForecast();
  const live = useLive();
  const prices = useAmberPrices(now);
  const noBattery = useNoBattery();
  const { data: home } = useQuery(homeQuery);
  return {
    now,
    p,
    s,
    f,
    prices,
    noBattery,
    cars: live?.ev ?? [],
    home,
    amber: s?.tariff?.type === "amber",
  };
}
