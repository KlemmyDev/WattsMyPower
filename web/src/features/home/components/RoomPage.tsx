import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { kWh, money } from "~/features/common/formatting/utils/number";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { STORE_HOME_RANGE, store } from "~/features/common/storage/utils";
import { COLOR } from "~/features/common/theme/utils/colors";
import { useNow } from "~/features/common/time/hooks";
import { addDays, midnight } from "~/features/common/time/utils";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Notice } from "~/features/common/ui/components/Notice";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { Swatch } from "~/features/common/ui/components/Swatch";
import { homeInsightsQuery, homePatternsQuery, homeProfileQuery, homeQuery, homeUsageQuery } from "~/features/home/api";
import { AheadCard, SpikesCard, WeekCard } from "~/features/home/components/Analysis";
import { ItemHero, itemStats } from "~/features/home/components/ItemHero";
import { LookButton } from "~/features/home/components/LookPicker";
import { ItemTile, runningOf } from "~/features/home/components/RoomTiles";
import { useHomeChange } from "~/features/home/hooks";
import type { HomeDevice, HomeUsage } from "~/features/home/types";
import {
  BEFORE_WORDS,
  defaultRoomIcon,
  deviceColors,
  drawing,
  givenRoomColor,
  homeItems,
  OTHER_COLOR,
  period,
  RANGE_WORDS,
  roomIcon,
  roomLook as roomLookOf,
  type Range,
  watts,
  RANGES,
} from "~/features/home/utils";
import type { Lane } from "~/features/home/utils/today";
import { BackLink } from "~/features/settings/components/SubPageHeader";

const pct = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;
const live = (d: HomeDevice) => !!d.now && d.now.online && !d.now.stale;

/**
 * A room: the plugs and appliances grouped under its name. Its top card in its own colour (used today against its
 * usual day, drawing now, what it's cost, its runs, what's always on and when best to run it, with its day and a lane
 * per device); each device lit by what it draws now, opening its page; then what each used and cost over a period,
 * when in the week it uses power, what's likely ahead and its spikes.
 */
export function RoomPage({ room, range }: { room: string; range: Range }) {
  const navigate = useNavigate();
  const now = useNow(60_000);
  const p = useSnapshot();
  const today = midnight(now);
  const [start, end, bucket] = period(range, now);
  const overview = useQuery(homeQuery);
  const usage = useQuery(homeUsageQuery(start, end, bucket));
  const todays = useQuery(homeUsageQuery(today, addDays(today, 1), "hour"));
  const before = useQuery({ ...homeUsageQuery(2 * start - end, start, "day"), enabled: range !== "today" });
  const patterns = useQuery(homePatternsQuery);
  const found = useQuery(homeInsightsQuery);
  const { roomLook } = useHomeChange();
  const devices = overview.data?.devices ?? [];
  const rooms = overview.data?.rooms ?? [];
  const colors = deviceColors(devices, rooms);
  const kinds = new Map((overview.data?.kinds ?? []).map((k) => [k.id, k]));
  const item = homeItems(devices).find((i) => i.group === room);
  const members = item?.members ?? [];
  const ids = members.map((d) => d.id);
  const profile = useQuery(homeProfileQuery(ids));
  const color = (item && deviceColors(devices, rooms, { byRoom: true }).get(item.id)) ?? COLOR.gridSoft;
  // What a kWh has cost the room over the last 30 days, to price what's ahead.
  const month = useQuery(homeUsageQuery(...period("month", now)));
  const spent = month.data?.devices.filter((u) => ids.includes(u.id)) ?? [];
  const spentKwh = spent.reduce((a, u) => a + u.total, 0);
  const rate = spentKwh > 0.1 ? spent.reduce((a, u) => a + u.cost, 0) / spentKwh : null;

  const many = members.length > 1;
  const run = runningOf(members);
  const running = members.filter((d) => d.now?.running && !d.now.stale);
  const reading = members.filter(live);
  const on = members.filter((d) => drawing(d) != null || (live(d) && d.now!.running));
  const w = members.reduce((a, d) => a + (drawing(d) ?? 0), 0);
  const estimated = members.some((d) => drawing(d) != null && d.now?.estimated);
  const lanes: Lane[] = (todays.data?.devices ?? [])
    .filter((u) => ids.includes(u.id) && u.total >= 0.01)
    .sort((a, b) => b.total - a.total)
    .map((u) => ({
      key: String(u.id),
      label: u.name,
      color: colors.get(u.id) ?? OTHER_COLOR,
      t: todays.data!.t,
      kwh: u.kwh,
      total: u.total,
    }));

  const sub = !members.length
    ? " "
    : running.length
      ? `${running.map((d) => d.name).join(" and ")} ${running.length === 1 ? "is" : "are"} running now`
      : [
          `${members.length} ${members.length === 1 ? "device" : "devices"}`,
          w ? `Using ${watts(w, estimated)} now` : "Idle now",
        ].join(" · ");

  return (
    <>
      <div className="pt-2">
        <BackLink to="/home">Home</BackLink>
      </div>
      <PageHeader
        title={
          members.length ? (
            <span className="flex items-center gap-3">
              <LookButton
                name={room}
                icon={roomIcon(room, members, rooms)}
                color={color}
                lit={on.length > 0}
                off={!reading.length}
                look={{ color: roomLookOf(rooms, room)?.color ?? null, icon: roomLookOf(rooms, room)?.icon ?? null }}
                given={{ color: givenRoomColor(devices, rooms, room), icon: defaultRoomIcon(room, members) }}
                onPick={(change) => roomLook.mutate({ name: room, ...change })}
                pending={roomLook.isPending}
                error={roomLook.error}
                size={40}
              />
              <span className="min-w-0">{room}</span>
            </span>
          ) : (
            room
          )
        }
        sub={sub}
      />
      {overview.data && !members.length && (
        <Notice>There's no room called {room}. It may have been renamed, or its devices moved out.</Notice>
      )}
      {members.length > 0 && (
        <div className="flex flex-col gap-5">
          <ItemHero
            name={room}
            color={color}
            profile={profile.data}
            now={now}
            lanes={lanes}
            live={{
              w: w >= 2 ? w : null,
              estimated,
              running: !!run,
              quiet: reading.length ? "Idle" : "Offline",
              status: run
                ? [many && run.device.name, run.phase, run.left != null && `${run.left} min left`]
                    .filter(Boolean)
                    .join(" · ")
                : !reading.length
                  ? "Not reading now"
                  : many
                    ? `${on.length} of ${members.length} on`
                    : on.length
                      ? "On"
                      : "Nothing on",
            }}
            stats={itemStats({
              members,
              today: todays.data,
              profile: profile.data,
              patterns: patterns.data,
              found: found.data,
              kinds,
              now,
            })}
          />

          <section aria-label="Devices now" className="flex flex-col gap-4">
            <TitleBlock
              className="pt-2"
              title="Devices now"
              sub={[
                on.length ? `${on.length} drawing power now` : "Nothing drawing power now",
                members.length - reading.length ? `${members.length - reading.length} offline` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,232px),1fr))] gap-4 max-sm:grid-cols-2 max-sm:gap-3">
              {[...members]
                .sort((a, b) => (drawing(b) ?? 0) - (drawing(a) ?? 0))
                .map((d) => (
                  <ItemTile
                    key={d.id}
                    item={{ id: d.id, group: null, members: [d] }}
                    devices={devices}
                    rooms={rooms}
                    color={colors.get(d.id) ?? OTHER_COLOR}
                    kinds={kinds}
                    homeW={p?.load_power != null ? Math.max(0, p.load_power) : null}
                    today={todays.data}
                    best={found.data?.best_times.find((b) => b.id === d.id)}
                    pattern={patterns.data?.find((x) => x.id === d.id)}
                    now={now}
                  />
                ))}
            </div>
          </section>

          <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1">
            <div className="flex min-w-0 flex-col gap-5">
              <RoomUsageCard
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
              {profile.data ? (
                <WeekCard profile={profile.data} color={color} />
              ) : (
                <Skeleton className="h-[300px] rounded-3xl" />
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              {profile.data ? (
                <>
                  <AheadCard profile={profile.data} color={color} rate={rate} />
                  <SpikesCard profile={profile.data} devices={members} colors={colors} />
                </>
              ) : (
                <Skeleton className="h-[300px] rounded-3xl" />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * What each of the room's devices used and cost over the period chosen, as one bar and a row each, with the room's
 * total, its share of the home's use and against the period before in a line under the title.
 */
function RoomUsageCard({
  members,
  usage,
  before,
  colors,
  range,
  onRange,
}: {
  members: HomeDevice[];
  usage: HomeUsage | undefined;
  before: HomeUsage | undefined;
  colors: Map<number, string>;
  range: Range;
  onRange: (r: Range) => void;
}) {
  const parts = members
    .map((d) => {
      const u = usage?.devices.find((x) => x.id === d.id);
      return { d, kwh: u?.total ?? 0, cost: u?.cost ?? 0, color: colors.get(d.id) ?? COLOR.gridSoft };
    })
    .sort((a, b) => b.kwh - a.kwh);
  const total = parts.reduce((a, p) => a + p.kwh, 0);
  const cost = parts.reduce((a, p) => a + p.cost, 0);
  const home = usage?.total.home;
  const was = before ? members.reduce((a, d) => a + (before.devices.find((u) => u.id === d.id)?.total ?? 0), 0) : null;
  const change = was != null && was > 0.05 ? (total - was) / was : null;

  return (
    <Card aria-labelledby="h-room-use" className="gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TitleBlock
          id="h-room-use"
          title="What each device used"
          sub={
            usage
              ? [
                  `${kWh(total)} · ${money(cost)} ${RANGE_WORDS[range]}`,
                  home ? `${pct(total, home)} of your home's use` : null,
                  change == null
                    ? null
                    : Math.abs(change) < 0.05
                      ? `about the same as ${BEFORE_WORDS[range]}`
                      : `${Math.round(Math.abs(change) * 100)}% ${change > 0 ? "more" : "less"} than ${BEFORE_WORDS[range]}`,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Each device's share"
          }
        />
        <Segmented label="Period" options={RANGES} value={range} onChange={onRange} />
      </div>

      {!usage ? (
        <Skeleton className="h-[140px]" />
      ) : (
        <>
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

          <div className="flex flex-col">
            <div className="grid grid-cols-[minmax(0,1fr)_80px_64px_48px] gap-x-4 pb-1.5 text-xs text-ink-muted max-sm:grid-cols-[minmax(0,1fr)_72px_56px]">
              <span>Device</span>
              <span className="text-right">Used</span>
              <span className="text-right">Cost</span>
              <span className="text-right max-sm:hidden">Share</span>
            </div>
            {parts.map((p) => (
              <div
                key={p.d.id}
                className="grid grid-cols-[minmax(0,1fr)_80px_64px_48px] items-center gap-x-4 border-t border-line-subtle py-2.5 text-sm tabular-nums max-sm:grid-cols-[minmax(0,1fr)_72px_56px]"
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
                <span className="text-right">{kWh(p.kwh)}</span>
                <span className="text-right text-ink-muted">{money(p.cost)}</span>
                <span className="text-right text-ink-faint max-sm:hidden">{total > 0 ? pct(p.kwh, total) : ""}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
