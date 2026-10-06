import { useQuery } from "@tanstack/react-query";
import { insightsQuery } from "~/features/battery/api";
import { BatteryControlCard } from "~/features/battery/components/BatteryControlCard";
import { BatteryHealth } from "~/features/battery/components/BatteryHealth";
import { BatterySize } from "~/features/battery/components/BatterySize";
import { useHasBattery } from "~/features/battery/hooks";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { useNow } from "~/features/common/time/hooks";
import { EmptyState } from "~/features/common/ui/components/EmptyState";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { useForecast } from "~/features/common/weather/hooks";
import { BatteryCard } from "~/features/overview/components/BatteryCard";

/**
 * The home battery: its level now and over the last few hours, the controls (standby, a floor, a charge from the
 * grid), then how it's holding up (health, cycles, warranty) and whether its size suits the house. Only in the
 * navigation when there's a battery.
 */
export function BatteryPage() {
  const now = useNow();
  const p = useSnapshot();
  const s = useSystem();
  const f = useForecast();
  const has = useHasBattery();
  const { data, isError } = useQuery({ ...insightsQuery, enabled: has });
  if (s && !has)
    return (
      <>
        <PageHeader title="Battery" sub="Control your battery, and see how it's holding up" />
        <EmptyState icon="battery" title="No battery found" id="h-nobat">
          Your inverter doesn't report a battery. If it has one, set its size in Settings → System.
        </EmptyState>
      </>
    );
  return (
    <>
      <PageHeader title="Battery" sub="Control your battery, and see how it's holding up" />
      {/* Two columns side by side on wide screens; on narrow ones the level, the controls, then the figures. */}
      <div className="grid grid-cols-12 items-start gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5 max-lg:contents">
          <BatteryCard p={p} s={s} f={f} now={now} title="Right now" shortcuts={false} className="max-lg:order-1" />
          {data ? (
            <BatteryHealth insights={data} system={s} className="max-lg:order-3 max-lg:col-span-12" />
          ) : (
            !isError && <Skeleton className="h-[420px] rounded-3xl max-lg:order-3 max-lg:col-span-12" />
          )}
        </div>
        <div className="flex flex-col gap-5 max-lg:contents">
          <BatteryControlCard className="max-lg:order-2 max-lg:col-span-12" />
          {data ? (
            <BatterySize sizing={data.sizing} className="max-lg:order-4 max-lg:col-span-12" />
          ) : (
            !isError && <Skeleton className="h-[420px] rounded-3xl max-lg:order-4 max-lg:col-span-12" />
          )}
        </div>
        {isError && !data && (
          // A failed refresh keeps showing the last figures; this only appears before the first load.
          <div className="col-span-12 text-sm text-ink-faint max-lg:order-5 lg:col-span-2">
            The battery's figures could not be loaded. Try again shortly.
          </div>
        )}
      </div>
    </>
  );
}
