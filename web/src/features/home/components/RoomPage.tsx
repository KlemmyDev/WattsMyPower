import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { kW, kWh, money } from "~/features/common/formatting/utils/number";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { STORE_HOME_RANGE, store } from "~/features/common/storage/utils";
import { COLOR } from "~/features/common/theme/utils/colors";
import { useNow } from "~/features/common/time/hooks";
import { Card } from "~/features/common/ui/components/Card";
import { Notice } from "~/features/common/ui/components/Notice";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { Swatch } from "~/features/common/ui/components/Swatch";
import { cn } from "~/features/common/ui/utils";
import { homeInsightsQuery, homePatternsQuery, homeQuery, homeUsageQuery } from "~/features/home/api";
import { DeviceCard } from "~/features/home/components/DeviceCard";
import { RANGES } from "~/features/home/components/UsageCard";
import type { HomeDevice, HomeUsage } from "~/features/home/types";
import {
  BEFORE_WORDS,
  deviceColors,
  drawing,
  homeItems,
  period,
  RANGE_WORDS,
  reading,
  type Range,
} from "~/features/home/utils";
import { BackLink } from "~/features/settings/components/SubPageHeader";

const pct = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;

/**
 * A room: the plugs and appliances grouped under its name. What the room used and cost in the period, split device by
 * device, then each of them on its own: what it's doing, its switch, what it used and its habits.
 */
export function RoomPage({ room, range }: { room: string; range: Range }) {
  const navigate = useNavigate();
  const now = useNow(60_000);
  const [start, end, bucket] = period(range, now);
  const overview = useQuery(homeQuery);
  const usage = useQuery(homeUsageQuery(start, end, bucket));
  const before = useQuery({ ...homeUsageQuery(2 * start - end, start, "day"), enabled: range !== "today" });
  const patterns = useQuery(homePatternsQuery);
  const found = useQuery(homeInsightsQuery);
  const devices = overview.data?.devices ?? [];
  const colors = deviceColors(devices);
  const kinds = new Map((overview.data?.kinds ?? []).map((k) => [k.id, k]));
  const members = homeItems(devices).find((i) => i.group === room)?.members ?? [];
  const running = members.filter((d) => d.now?.running && !d.now.stale);
  const w = members.reduce((a, d) => a + (drawing(d) ?? 0), 0);
  const beforeOf = (id: number) =>
    before.data && range !== "today" ? (before.data.devices.find((u) => u.id === id)?.total ?? 0) : undefined;

  const sub = !members.length
    ? " "
    : [
        `${members.length} ${members.length === 1 ? "device" : "devices"}`,
        running.length
          ? `${running.map((d) => d.name).join(" and ")} ${running.length === 1 ? "is" : "are"} running`
          : w
            ? `Using ${kW(w)} now`
            : "Idle now",
      ].join(" · ");

  return (
    <>
      <div className="pt-2">
        <BackLink to="/home">Home</BackLink>
      </div>
      <PageHeader title={room} sub={sub} />
      {overview.data && !members.length && (
        <Notice>There's no room called {room}. It may have been renamed, or its devices taken out of it.</Notice>
      )}
      {members.length > 0 && (
        <div className="grid grid-cols-12 gap-5">
          <RoomUsageCard
            room={room}
            members={members}
            usage={usage.data}
            before={range === "today" ? undefined : before.data}
            colors={colors}
            range={range}
            onRange={(r) => {
              store.set(STORE_HOME_RANGE, r); // as on Home: opened again later, it shows this period
              void navigate({ to: "/home/rooms/$room", params: { room }, search: { range: r }, replace: true });
            }}
          />
          {members.map((d) => (
            <DeviceCard
              key={d.id}
              device={d}
              used={usage.data?.devices.find((u) => u.id === d.id)}
              before={beforeOf(d.id)}
              pattern={patterns.data?.find((p) => p.id === d.id)}
              cycles={!!kinds.get(d.kind)?.cycles}
              kindLabel={kinds.get(d.kind)?.label ?? "Device"}
              color={colors.get(d.id) ?? COLOR.gridSoft}
              home={usage.data?.total.home ?? null}
              rangeLabel={RANGE_WORDS[range]}
              beforeLabel={BEFORE_WORDS[range]}
              best={found.data?.best_times.find((b) => b.id === d.id)}
              saving={found.data?.savings.find((x) => x.id === d.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * What the room used and cost in the period, its share of the home's use and against the period before; then the
 * same split device by device, as one bar and a row each with what it's drawing now.
 */
function RoomUsageCard({
  room,
  members,
  usage,
  before,
  colors,
  range,
  onRange,
}: {
  room: string;
  members: HomeDevice[];
  usage: HomeUsage | undefined;
  before: HomeUsage | undefined;
  colors: Map<number, string>;
  range: Range;
  onRange: (r: Range) => void;
}) {
  const parts = members.map((d) => {
    const u = usage?.devices.find((x) => x.id === d.id);
    return { d, kwh: u?.total ?? 0, cost: u?.cost ?? 0, color: colors.get(d.id) ?? COLOR.gridSoft };
  });
  const total = parts.reduce((a, p) => a + p.kwh, 0);
  const cost = parts.reduce((a, p) => a + p.cost, 0);
  const home = usage?.total.home;
  const was = before ? members.reduce((a, d) => a + (before.devices.find((u) => u.id === d.id)?.total ?? 0), 0) : null;
  const change = was != null && was > 0.05 ? (total - was) / was : null;

  return (
    <Card aria-labelledby="h-room-use" className="col-span-12 gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="h-room-use">What {room} used</h2>
          <span className="text-[13px] text-ink-muted">Each device's part of it, {RANGE_WORDS[range]}</span>
        </div>
        <Segmented label="Period" options={RANGES} value={range} onChange={onRange} />
      </div>

      {!usage ? (
        <Skeleton className="h-[180px]" />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <div className="flex flex-col gap-1">
              <span className="text-[13px] text-ink-muted">Used</span>
              <span className="text-[40px] leading-11 font-light tracking-[-1.5px] tabular-nums">{kWh(total)}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[13px] text-ink-muted">Cost</span>
              <span className="text-[40px] leading-11 font-light tracking-[-1.5px] tabular-nums">{money(cost)}</span>
            </div>
            <div className="flex flex-col gap-1 pb-1.5 text-sm text-ink-muted tabular-nums">
              {home ? (
                <span>
                  <b className="font-semibold text-ink">{pct(total, home)}</b> of what your home used
                </span>
              ) : null}
              {change != null && (
                <span>
                  {Math.abs(change) < 0.05
                    ? `About the same as ${BEFORE_WORDS[range]}`
                    : `${Math.round(Math.abs(change) * 100)}% ${change > 0 ? "more" : "less"} than ${BEFORE_WORDS[range]}`}
                </span>
              )}
            </div>
          </div>

          {total > 0 && (
            <div
              className="flex h-3 gap-[2px] overflow-hidden rounded-full"
              role="img"
              aria-label="Share of the room's use"
            >
              {parts
                .filter((p) => p.kwh > 0)
                .map((p) => (
                  <span key={p.d.id} style={{ flexGrow: p.kwh, background: p.color }} className="min-w-[3px]" />
                ))}
            </div>
          )}

          <div className="-mt-2 flex flex-col">
            <div className="grid grid-cols-[minmax(0,1fr)_80px_88px_64px_52px] gap-x-4 pb-1.5 text-xs text-ink-faint max-sm:grid-cols-[minmax(0,1fr)_72px_64px]">
              <span>Device</span>
              <span className="text-right">Now</span>
              <span className="text-right">Used</span>
              <span className="text-right max-sm:hidden">Cost</span>
              <span className="text-right max-sm:hidden">Share</span>
            </div>
            {parts.map((p) => {
              const live = drawing(p.d);
              return (
                <div
                  key={p.d.id}
                  className="grid grid-cols-[minmax(0,1fr)_80px_88px_64px_52px] items-center gap-x-4 border-t border-line-subtle py-2.5 text-sm tabular-nums max-sm:grid-cols-[minmax(0,1fr)_72px_64px]"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Swatch color={p.color} size={10} />
                    <Link
                      to="/home/$device"
                      params={{ device: String(p.d.id) }}
                      className="truncate font-medium text-ink no-underline hover:underline"
                    >
                      {p.d.name}
                    </Link>
                  </span>
                  <span className={cn("text-right", live ? "text-ink" : "text-ink-faint")}>{reading(p.d)}</span>
                  <span className="text-right">{kWh(p.kwh)}</span>
                  <span className="text-right text-ink-muted max-sm:hidden">{money(p.cost)}</span>
                  <span className="text-right text-ink-faint max-sm:hidden">{total > 0 ? pct(p.kwh, total) : ""}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
