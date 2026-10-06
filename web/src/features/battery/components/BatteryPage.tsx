import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { batteryQuery, insightsQuery } from "~/features/battery/api";
import { BatteryDayChart } from "~/features/battery/components/BatteryDayChart";
import { BatteryHealth } from "~/features/battery/components/BatteryHealth";
import { BatteryModes } from "~/features/battery/components/BatteryModes";
import { BatteryPanel } from "~/features/battery/components/BatteryPanel";
import { BatterySize } from "~/features/battery/components/BatterySize";
import { useBatteryMode, useHasBattery } from "~/features/battery/hooks";
import type { BatteryPlan } from "~/features/battery/types";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { useNow } from "~/features/common/time/hooks";
import { EmptyState } from "~/features/common/ui/components/EmptyState";
import { Skeleton } from "~/features/common/ui/components/Skeleton";

/**
 * The home battery: big and simple at the top (its level, what it's doing, what it's set to do), the controls beside
 * a day of its level with what it was set to do shaded in (and, while choosing a control, what that would do), then
 * how it's holding up and whether its size suits the house. Only in the navigation when there's a battery.
 */
export function BatteryPage() {
  const now = useNow(30_000);
  const p = useSnapshot();
  const s = useSystem();
  const mode = useBatteryMode();
  const has = useHasBattery();
  const { data: view } = useQuery({ ...batteryQuery, enabled: has });
  const { data, isError } = useQuery({ ...insightsQuery, enabled: has });
  const [preview, setPreview] = useState<BatteryPlan | null>(null);
  const v = view?.supported ? view : undefined;
  const header = <PageHeader title="Battery" sub="See what your battery is doing, and tell it what to do" />;
  if (s && !has)
    return (
      <>
        {header}
        <EmptyState icon="battery" title="No battery found" id="h-nobat">
          Your inverter doesn't report a battery. If it has one, set its size in Settings → System.
        </EmptyState>
      </>
    );
  return (
    <>
      {header}
      <div className="flex flex-col gap-5">
        <BatteryPanel v={v} p={p} s={s} mode={mode} now={now} />
        <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start gap-5 max-3xl:grid-cols-1">
          {v ? (
            <BatteryModes v={v} soc={p?.battery_soc ?? null} now={now} onPreview={setPreview} />
          ) : (
            view?.supported === false && (
              <div className="rounded-3xl bg-surface p-7 text-sm text-ink-muted">{view.reason}</div>
            )
          )}
          <BatteryDayChart s={s} now={now} plan={v?.plan ?? null} preview={preview} log={view?.log ?? []} />
        </div>
        <div className="grid grid-cols-2 items-start gap-5 max-lg:grid-cols-1">
          {data ? (
            <>
              <BatteryHealth insights={data} system={s} />
              <BatterySize sizing={data.sizing} />
            </>
          ) : isError ? (
            <div className="text-sm text-ink-faint">The battery's figures could not be loaded. Try again shortly.</div>
          ) : (
            <>
              <Skeleton className="h-[420px] rounded-3xl" />
              <Skeleton className="h-[420px] rounded-3xl" />
            </>
          )}
        </div>
      </div>
    </>
  );
}
