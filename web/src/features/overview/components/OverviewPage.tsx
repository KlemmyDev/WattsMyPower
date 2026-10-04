import { AmberPricesCard } from "~/features/amber/components/AmberPricesCard";
import { CarCards } from "~/features/car/components/CarCard";
import { useAmberPrices } from "~/features/amber/hooks";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { useForecast } from "~/features/common/weather/hooks";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { useNow } from "~/features/common/time/hooks";
import { greeting } from "~/features/common/time/utils";
import { BatteryCard } from "~/features/overview/components/BatteryCard";
import { Next24Card } from "~/features/overview/components/Next24Card";
import { PowerFlowHero } from "~/features/overview/components/PowerFlowHero";
import { TodayCard } from "~/features/overview/components/TodayCard";
import { TodayEnergyCard } from "~/features/overview/components/TodayEnergyCard";

export function OverviewPage() {
  const now = useNow();
  const p = useSnapshot();
  const s = useSystem();
  const f = useForecast();
  const prices = useAmberPrices(now);
  return (
    <>
      <PageHeader title={greeting(new Date(now * 1000))} sub="Here is how your home is running right now" />
      <div className="grid grid-cols-12 gap-5">
        <PowerFlowHero p={p} s={s} f={f} now={now} />
        <BatteryCard p={p} s={s} f={f} now={now} />
        <TodayCard tariff={s?.tariff} now={now} />
        <TodayEnergyCard p={p} now={now} />
        <CarCards now={now} />
        {prices && <AmberPricesCard prices={prices} now={now} />}
      </div>
      <Next24Card p={p} s={s} f={f} now={now} prices={prices} />
    </>
  );
}
