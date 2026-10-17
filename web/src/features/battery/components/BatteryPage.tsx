import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AllBatteries, roomBatteries } from "~/features/battery/components/AllBatteries";
import { BatteryActivity } from "~/features/battery/components/BatteryActivity";
import { BatteryHealth } from "~/features/battery/components/BatteryHealth";
import { BatteryModes } from "~/features/battery/components/BatteryModes";
import { BatteryBackup, BatteryDays, BatteryReadings, BatteryToday } from "~/features/battery/components/BatteryMore";
import { BatteryDayChart } from "~/features/battery/components/BatteryDayChart";
import { useBatteryHero } from "~/features/battery/components/BatterySky";
import { BatterySize } from "~/features/battery/components/BatterySize";
import {
  useBatteryDay,
  useBatteryInsights,
  useBatteryMode,
  useBatteryView,
  useNoBattery,
} from "~/features/battery/hooks";
import type { BatteryPlan, BatteryView, ControlRequest } from "~/features/battery/types";
import { batteryState, ON } from "~/features/common/energy/utils";
import type { BatteryMode, Snapshot } from "~/features/common/live/types";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { useForecast } from "~/features/common/weather/hooks";
import { Card } from "~/features/common/ui/components/Card";
import { EmptyState } from "~/features/common/ui/components/EmptyState";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { homeQuery } from "~/features/home/api";
import { useLiveDay, useLiveHero } from "~/features/live/hooks";

/** What the battery's up to, in a few words, for under the page's title. */
function doing(p: Snapshot | null, mode: BatteryMode | null, v: BatteryView | undefined): string {
  const c = v?.supported && v.control && !v.control.ending ? v.control : null;
  if (c?.kind === "standby") return "On standby, holding its charge";
  if (c?.kind === "floor") return `Keeping ${c.floor}% in reserve for now`;
  if (c?.kind === "charge") return `Charging from the grid to ${c.target ?? 100}%`;
  if (mode?.owner === "isolarcloud") return "iSolarCloud has the battery for now";
  if (mode?.owner === "external" || mode?.owner === "elsewhere") return "Something else has the battery for now";
  const st = batteryState(p?.battery_power);
  if (st === "charge") return (p?.pv_power ?? 0) > ON ? "Charging from solar" : "Charging";
  if (st === "discharge") return "Running your home";
  return "See what your battery is doing, and tell it what to do";
}

/**
 * The home battery. Its top card is the one the live pages share (its part is useBatteryHero): the sky with your
 * battery and inverter in it, what it's doing and what comes next, its level, what's going in or out, and the day's
 * chart, which scrubs the day. Under it the controls, the day in full (earlier days, what it was set to do, the rates,
 * and while choosing a control, what that would do), where today's charge came from and went, how long it would keep
 * the house going without the grid, what it did, its readings, the last 30 days, how it's holding up, and whether its
 * size suits the house. With portable batteries in rooms (Home's devices), all of them together under the card. Only
 * in the navigation when there's a battery.
 */
export function BatteryPage() {
  const { now } = useLiveDay();
  const p = useSnapshot();
  const s = useSystem();
  const mode = useBatteryMode();
  const none = useNoBattery();
  const v = useBatteryView();
  const { data, isError } = useBatteryInsights();
  const [preview, setPreview] = useState<BatteryPlan | null>(null);
  const [draft, setDraft] = useState<ControlRequest | null>(null);
  const f = useForecast();
  const { start, series } = useBatteryDay(now);
  const { data: home } = useQuery(homeQuery);
  const rooms = roomBatteries(home?.devices);
  const hero = useBatteryHero({ v, p, s, mode, series, preview, draft });
  useLiveHero(s && none ? null : hero);
  // Still reachable by its address on a solar-only system (it's left out of the navigation): say why it's empty.
  if (s && none)
    return (
      <>
        <PageHeader title="Battery" sub={doing(p, mode, v)} />
        <div className="flex flex-col gap-5">
          {rooms.length > 0 && <AllBatteries p={p} s={s} devices={rooms} />}
          {s.inverter_connected === false ? (
            <EmptyState icon="battery" title="No battery connected" id="h-nobat">
              Connect your inverter in Manage → Integrations → Inverters, and its battery shows here.
            </EmptyState>
          ) : (
            <EmptyState icon="battery" title="No battery connected" id="h-nobat">
              Your inverter doesn't report a battery, so this looks like a solar-only system. If it does have one, set
              its size in Settings.
            </EmptyState>
          )}
        </div>
      </>
    );
  return (
    <>
      {rooms.length > 0 && <AllBatteries p={p} s={s} devices={rooms} />}
      {/* Two columns that grow on their own (the controls opening doesn't stretch the other side): what went in and
            out, the last 30 days and its health on the left; the controls, backup, what they did, its readings and
            size on the right. Narrower, one column: the controls first. */}
      <div className="live-cols grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-5 max-3xl:contents">
          <Card className="max-3xl:order-2">
            <BatteryDayChart
              s={s}
              now={now}
              plan={v?.plan ?? null}
              outlook={v?.outlook ?? null}
              preview={preview}
              draft={draft}
            />
          </Card>
          <BatteryToday series={series} p={p} s={s} className="max-3xl:order-2" />
          <BatteryDays s={s} now={now} className="max-3xl:order-6" />
          {data ? (
            <BatteryHealth insights={data} system={s} className="max-3xl:order-7" />
          ) : (
            !isError && <Skeleton className="h-[420px] rounded-3xl max-3xl:order-7" />
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
          <BatteryBackup p={p} s={s} f={f} now={now} className="max-3xl:order-3" />
          <BatteryActivity now={now} className="max-3xl:order-4" />
          <BatteryReadings series={series} p={p} s={s} start={start} now={now} className="max-3xl:order-5" />
          {data ? (
            <BatterySize sizing={data.sizing} className="max-3xl:order-8" />
          ) : (
            !isError && <Skeleton className="h-[300px] rounded-3xl max-3xl:order-8" />
          )}
        </div>
        {isError && !data && (
          <div className="text-sm text-ink-faint max-3xl:order-10">
            Couldn't load the battery's figures. Try again in a moment.
          </div>
        )}
      </div>
    </>
  );
}
