import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { batteryQuery, insightsQuery } from "~/features/battery/api";
import { BatteryActivity } from "~/features/battery/components/BatteryActivity";
import { BatteryDayChart } from "~/features/battery/components/BatteryDayChart";
import { BatteryHealth } from "~/features/battery/components/BatteryHealth";
import { BatteryModes } from "~/features/battery/components/BatteryModes";
import { BatteryPanel } from "~/features/battery/components/BatteryPanel";
import { BatterySize } from "~/features/battery/components/BatterySize";
import { useBatteryMode, useHasBattery } from "~/features/battery/hooks";
import type { BatteryPlan, ControlRequest } from "~/features/battery/types";
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
  const [draft, setDraft] = useState<ControlRequest | null>(null);
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
        {/* Two columns that grow on their own (the controls opening doesn't stretch the chart): the day and the
            battery's health on the left; the controls, what they did, and its size on the right. Narrower, one
            column: the controls first. */}
        <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1">
          <div className="flex min-w-0 flex-col gap-5 max-3xl:contents">
            <BatteryDayChart
              s={s}
              now={now}
              plan={v?.plan ?? null}
              outlook={v?.outlook ?? null}
              preview={preview}
              draft={draft}
              className="max-3xl:order-2"
            />
            {data ? (
              <BatteryHealth insights={data} system={s} className="max-3xl:order-4" />
            ) : (
              !isError && <Skeleton className="h-[420px] rounded-3xl max-3xl:order-4" />
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-5 max-3xl:contents">
            {v ? (
              <BatteryModes
                v={v}
                soc={p?.battery_soc ?? null}
                now={now}
                onPreview={setPreview}
                onDraft={setDraft}
                className="max-3xl:order-1"
              />
            ) : (
              <Skeleton className="h-[260px] rounded-3xl max-3xl:order-1" />
            )}
            <BatteryActivity now={now} className="max-3xl:order-3" />
            {data ? (
              <BatterySize sizing={data.sizing} className="max-3xl:order-5" />
            ) : (
              !isError && <Skeleton className="h-[300px] rounded-3xl max-3xl:order-5" />
            )}
          </div>
          {isError && !data && (
            <div className="text-sm text-ink-faint max-3xl:order-6">
              The battery's figures could not be loaded. Try again shortly.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
