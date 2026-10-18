import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useState, type ReactNode } from "react";
import { hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { dollars, kW, kWh, money, pct } from "~/features/common/formatting/utils/number";
import { STORE_HOME_VIEW, store } from "~/features/common/storage/utils";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, midnight } from "~/features/common/time/utils";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { cn } from "~/features/common/ui/utils";
import { roomOf } from "~/features/common/widgets/room";
import { useHomeCharging } from "~/features/ev/hooks";
import { homeInsightsQuery, homePatternsQuery, homeUsageQuery } from "~/features/home/api";
import { Power } from "~/features/home/components/DeviceCard";
import { LookButton } from "~/features/home/components/LookPicker";
import { useHomeChange } from "~/features/home/hooks";
import type { BestTime, DevicePattern, HomeDevice, HomeOverview, HomeUsage, RoomLook } from "~/features/home/types";
import {
  CAR_COLOR,
  defaultDeviceIcon,
  defaultRoomIcon,
  deviceColors,
  deviceIcon,
  drawing,
  givenDeviceColor,
  givenRoomColor,
  groupPattern,
  groupUsage,
  habitLine,
  homeItems,
  liveBreakdown,
  OTHER_COLOR,
  roomIcon,
  roomLook as roomLookOf,
  watts,
  type HomeItem,
} from "~/features/home/utils";

const live = (d: HomeDevice) => !!d.now && d.now.online && !d.now.stale;

/** What's running in a room or on a device: the first appliance mid-run, its phase, how long is left and how far in. */
export function runningOf(members: HomeDevice[]) {
  const d = members.find((m) => live(m) && m.now!.running);
  if (!d) return null;
  const n = d.now!;
  const left = n.remaining_min != null ? Math.round(n.remaining_min) : null;
  const elapsed = n.run ? Math.max(0, n.at - n.run.start) : null;
  return {
    device: d,
    phase: n.phase ?? n.program ?? "Running",
    left,
    /** How far through the run (0 to 1); null when it doesn't say how long is left. */
    progress: left != null && elapsed != null && elapsed + left * 60 > 0 ? elapsed / (elapsed + left * 60) : null,
    done: left != null ? n.at + left * 60 : null,
  };
}

/** When best to run an appliance next, in a line: "Best run 11:00 to 14:00, 80% on sunshine". */
const bestLine = (b: BestTime) =>
  b.why === "solar"
    ? `Best run ${hhmm(b.start)} to ${hhmm(b.end)}, ${pct(b.solar_share * 100)} on sunshine`
    : `Cheapest to run from ${hhmm(b.start)}, about ${money(b.cost)}`;

/** A tile's look by how much it draws: a glow from its corner and a border, brighter the bigger its share of the home's. */
const glow = (color: string, share: number) => ({
  backgroundImage: `radial-gradient(circle at 0% 0%, ${alpha(color, 0.05 + 0.3 * Math.min(1, share))}, transparent 70%)`,
  borderColor: share > 0.3 ? alpha(color, 0.35) : undefined,
});

/** Today hour by hour as a filled line, up to now, scaled to its own busiest hour. */
export function HourSpark({
  kwh,
  t,
  now,
  color,
  dashed = false,
  className,
}: {
  kwh: (number | null)[];
  t: number[];
  now: number;
  color: string;
  dashed?: boolean;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const n = t.findIndex((x) => x > now);
  const upto = n < 0 ? t.length : n;
  const pts = kwh.slice(0, upto).map((v) => v ?? 0);
  if (pts.length < 2) return <div className={cn("h-10", className)} />;
  const top = Math.max(0.01, ...pts) * 1.15;
  const W = 240;
  const H = 40;
  const x = (i: number) => (i / Math.max(1, t.length - 1)) * W;
  const y = (v: number) => H - 1 - (v / top) * (H - 3);
  const line = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg aria-hidden viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cn("h-10 w-full", className)}>
      <defs>
        <linearGradient id={`${id}-f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.26" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {!dashed && <path d={`${line} L${x(pts.length - 1)} ${H} L0 ${H} Z`} fill={`url(#${id}-f)`} />}
      <path
        d={line}
        fill="none"
        strokeWidth={1.75}
        strokeDasharray={dashed ? "3 3" : undefined}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        style={{ stroke: color }}
      />
    </svg>
  );
}

/**
 * One lit tile: an icon in its colour, its name and share of the home now, what it draws in big figures, its day as a
 * line, and a line at its foot. It glows from the corner with what it draws, brighter the more. With `link`, the whole
 * tile opens its page (its controls, the look and a switch, still work on their own). Given `w` and `h` (a dashboard
 * widget's size) it fits what it shows to them; on the page it shows it all.
 */
export function LitTile({
  color,
  icon,
  look,
  name,
  link,
  action,
  share,
  value,
  muted = false,
  dashed = false,
  spark,
  foot,
  footRight,
  note,
  progress,
  w,
  h,
  className,
}: {
  color: string;
  icon: IconName;
  /** In place of the icon: a button that changes the tile's colour and icon. */
  look?: ReactNode;
  name: string;
  /** A link over the whole tile, to its page: given its name for a screen reader and the classes that stretch it. */
  link?: (props: { className: string; "aria-label": string }) => ReactNode;
  /** A control at the top right (a device's switch), in place of the share. */
  action?: ReactNode;
  /** Its share of what the home draws now (0 to 1), for the glow and the corner; null to leave the corner empty. */
  share: number | null;
  /** The figure, e.g. "1,180 W", "Idle". */
  value: string;
  muted?: boolean;
  /** Everything else (what no plug measures): a dashed outline and line. */
  dashed?: boolean;
  spark?: ReactNode;
  foot?: ReactNode;
  footRight?: ReactNode;
  /** A quieter line under the foot (its habits). */
  note?: ReactNode;
  /** How far through a run (0 to 1), as a bar at the foot. */
  progress?: number | null;
  w?: number;
  h?: number;
  className?: string;
}) {
  const room = w != null && h != null ? roomOf(w, h) : null;
  const small = room?.tall === "short";
  const narrow = room?.wide === "xs";
  const [v, unit] = value.includes(" ")
    ? [value.slice(0, value.lastIndexOf(" ")), value.slice(value.lastIndexOf(" ") + 1)]
    : [value, ""];
  return (
    <section
      aria-label={name}
      className={cn(
        "glass relative flex h-full min-w-0 flex-col gap-3 overflow-hidden rounded-[22px] border border-line-subtle p-5 transition-[background-image,border-color,translate] duration-700 max-sm:p-4",
        dashed && "border-dashed bg-transparent",
        link &&
          "hover:-translate-y-0.5 hover:border-fg/15 hover:duration-200 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-brand",
        className,
      )}
      style={dashed ? undefined : glow(color, share ?? 0)}
    >
      {link?.({ className: "absolute inset-0 z-0 rounded-[inherit] outline-none", "aria-label": `Open ${name}` })}
      {/* Above the link, but letting the pointer through to it except on the controls. */}
      <div className="pointer-events-none relative z-1 flex min-w-0 items-center gap-2.5">
        {look ? (
          <span className="pointer-events-auto flex-none">{look}</span>
        ) : (
          <span
            className="flex size-9 flex-none items-center justify-center rounded-xl"
            style={{
              background: alpha(dashed ? COLOR.fg : color, dashed ? 0.06 : 0.18),
              color: dashed ? COLOR.inkMuted : color,
            }}
          >
            <Icon name={icon} size={18} />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
        {action && !narrow ? (
          <span className="pointer-events-auto flex-none">{action}</span>
        ) : (
          share != null &&
          share > 0 &&
          !narrow && (
            <span className="text-xs text-ink-faint tabular-nums max-sm:hidden">
              {share < 0.005 ? "<1%" : pct(share * 100)}
            </span>
          )
        )}
      </div>
      <span
        className={cn(
          "pointer-events-none relative z-1 flex items-baseline gap-1 font-light tabular-nums",
          muted ? "text-ink-quiet" : "text-ink",
        )}
      >
        <span className="text-[34px] leading-[38px] tracking-[-1.2px] max-sm:text-[28px] max-sm:leading-8">{v}</span>
        {unit && <span className="text-sm text-ink-faint">{unit}</span>}
      </span>
      {!small && spark && <div className="pointer-events-none relative z-1">{spark}</div>}
      {!small && (foot || footRight || note || progress != null) && (
        <div className="pointer-events-none relative z-1 mt-auto flex flex-col gap-2 border-t border-line-subtle pt-2.5">
          <div className="flex items-baseline justify-between gap-3 text-[12.5px] max-sm:flex-col max-sm:gap-0.5">
            <span className="min-w-0 truncate text-ink-soft">{foot}</span>
            {footRight && !narrow && (
              <span className="flex-none text-ink-muted tabular-nums max-sm:text-xs">{footRight}</span>
            )}
          </div>
          {note && <span className="-mt-1 truncate text-[11.5px] text-ink-faint">{note}</span>}
          {progress != null && (
            <span className="relative block h-1 rounded-full bg-track">
              <span
                className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out-soft"
                style={{ width: `${Math.min(1, progress) * 100}%`, background: color }}
              />
            </span>
          )}
        </div>
      )}
    </section>
  );
}

/** A room's (or a device's on its own) tile, from what its members draw now, used today, and usually do. */
export function ItemTile({
  item,
  devices,
  rooms,
  color,
  kinds,
  homeW,
  today,
  pattern,
  best,
  now,
  w,
  h,
}: {
  item: HomeItem;
  /** Every device, for the colour each is given without one chosen. */
  devices: HomeDevice[];
  rooms: RoomLook[] | undefined;
  color: string;
  /** The device kinds by id: their names (for a switch's warning) and whether they run in cycles. */
  kinds: Map<string, { label: string; cycles: boolean }>;
  /** What the home draws now (W), for its share. */
  homeW: number | null;
  /** Today hour by hour, grouped as the tiles are (groupUsage). */
  today: HomeUsage | undefined;
  /** Its habits over the last eight weeks (a room's, together). */
  pattern: DevicePattern | undefined;
  /** For an appliance that runs in cycles, when best to run it next. */
  best?: BestTime;
  now: number;
  w?: number;
  h?: number;
}) {
  const { roomLook, deviceLook } = useHomeChange();
  const m = item.members;
  const first = m[0];
  const reading = m.filter(live);
  const drawW = reading.reduce((a, d) => a + (d.now!.power_w ?? 0), 0);
  const estimated = reading.some((d) => d.now!.estimated && (d.now!.power_w ?? 0) > 0);
  const offline = !reading.length;
  const lastRead = Math.max(0, ...m.map((d) => d.now?.at ?? 0));
  const lit = reading.some((d) => d.now!.running || drawing(d) != null);
  const run = runningOf(m);
  const used = today?.devices.find((u) => u.id === item.id);
  const name = item.group ?? first.name;
  const others = m.filter((d) => d !== run?.device).map((d) => d.name);
  const cycles = m.every((d) => kinds.get(d.kind)?.cycles);
  const look = item.group ? (
    <LookButton
      name={item.group}
      icon={roomIcon(item.group, m, rooms)}
      color={color}
      lit={lit}
      off={offline}
      look={{ color: roomLookOf(rooms, item.group)?.color ?? null, icon: roomLookOf(rooms, item.group)?.icon ?? null }}
      given={{ color: givenRoomColor(devices, rooms ?? [], item.group), icon: defaultRoomIcon(item.group, m) }}
      onPick={(change) => roomLook.mutate({ name: item.group!, ...change })}
      pending={roomLook.isPending}
      error={roomLook.error}
      size={36}
    />
  ) : (
    <LookButton
      name={first.name}
      icon={deviceIcon(first)}
      color={color}
      lit={lit}
      off={offline}
      look={{ color: first.color ?? null, icon: first.icon ?? null }}
      given={{ color: givenDeviceColor(devices, rooms ?? [], first.id), icon: defaultDeviceIcon(first) }}
      onPick={(change) => deviceLook.mutate({ id: first.id, ...change })}
      pending={deviceLook.isPending}
      error={deviceLook.error}
      size={36}
    />
  );
  return (
    <LitTile
      color={color}
      icon={item.group ? roomIcon(item.group, m, rooms) : deviceIcon(first)}
      look={look}
      name={name}
      link={(props) =>
        item.group ? (
          <Link to="/home/rooms/$room" params={{ room: item.group }} {...props} />
        ) : (
          <Link to="/home/$device" params={{ device: String(item.id) }} {...props} />
        )
      }
      action={!item.group ? <Power device={first} kindLabel={kinds.get(first.kind)?.label ?? "Device"} /> : undefined}
      share={!offline && homeW ? drawW / homeW : null}
      value={offline ? "Offline" : drawW >= 2 ? watts(drawW, estimated) : "Idle"}
      muted={offline || drawW < 2}
      spark={
        today && used ? (
          <HourSpark kwh={used.kwh} t={today.t} now={now} color={color} />
        ) : today ? (
          <div className="h-10" />
        ) : null
      }
      foot={
        offline
          ? lastRead
            ? `Not read since ${lastRead >= midnight(now) ? "" : `${shortDay.format(lastRead * 1000)}, `}${hhmm(lastRead)}`
            : "Not read yet. Check its connection in Integrations"
          : run
            ? `${item.group ? `${run.device.name} · ` : ""}${run.phase}`
            : item.group
              ? others.join(", ")
              : (first.model ?? kinds.get(first.kind)?.label ?? "")
      }
      footRight={
        run
          ? run.left != null
            ? `${run.left} min left`
            : "Running"
          : used
            ? `${kWh(used.total)}${used.cost >= 0.005 ? ` · ${money(used.cost)}` : ""} today`
            : undefined
      }
      note={!run && best ? bestLine(best) : habitLine(pattern, cycles)}
      progress={run?.progress}
      w={w}
      h={h}
    />
  );
}

/**
 * The home's rooms right now, as lit tiles, the most drawing first, each opening its page: each room (or device on its
 * own, or every device by itself) with what it draws, its day as a line, what it's used and cost today, its habits,
 * what's running and, for a device, its switch; its icon changes its look. Then the car while it charges at home,
 * everything no plug measures, and what the house draws all the time.
 */
export function RoomsNow({
  devices,
  rooms,
  kinds: kindList,
  best = [],
  load,
  now,
  framed = false,
}: {
  devices: HomeDevice[];
  rooms: RoomLook[] | undefined;
  kinds: HomeOverview["kinds"] | undefined;
  /** When best to run each appliance that runs in cycles, today or tomorrow. */
  best?: BestTime[];
  /** What the home is drawing, from the inverter (W). */
  load: number | null | undefined;
  now: number;
  /** In a card of its own, as a dashboard widget; else a heading over loose tiles, as on the page. */
  framed?: boolean;
}) {
  const carW = useHomeCharging();
  const start = midnight(now);
  const { data: usage } = useQuery(homeUsageQuery(start, addDays(start, 1), "hour"));
  const { data: found } = useQuery(homeInsightsQuery);
  const { data: patterns } = useQuery(homePatternsQuery);
  // By room, the plugs in a room as one; by device, each on its own (as last chosen in this browser).
  const [view, setView] = useState<"rooms" | "devices">(() =>
    store.get(STORE_HOME_VIEW) === "devices" ? "devices" : "rooms",
  );
  const hasRooms = devices.some((d) => d.group && !d.hidden);
  const byRoom = view === "rooms" || !hasRooms;
  const items = homeItems(devices, byRoom);
  const colors = deviceColors(devices, rooms, { byRoom });
  const kinds = new Map((kindList ?? []).map((k) => [k.id, k]));
  const split = liveBreakdown(devices, load, { carW });
  const today = usage && groupUsage(usage, items);
  const homeW = load != null ? Math.max(0, load) : null;
  const drawW = (i: HomeItem) => i.members.filter(live).reduce((a, d) => a + (d.now!.power_w ?? 0), 0);
  const order = [...items].sort((a, b) => drawW(b) - drawW(a));
  const measured = split ? split.measured + split.car : 0;
  const standby = found?.standby;
  const on = items.filter((i) => i.members.some((d) => drawing(d) != null || (live(d) && d.now!.running)));
  const offline = items.filter((i) => i.members.every((d) => !live(d)));

  const tiles = (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,232px),1fr))] gap-4 max-sm:grid-cols-2 max-sm:gap-3">
      {order.map((item) => (
        <ItemTile
          key={item.id}
          item={item}
          devices={devices}
          rooms={rooms}
          color={colors.get(item.id) ?? OTHER_COLOR}
          kinds={kinds}
          homeW={homeW}
          today={today}
          best={item.group ? undefined : best.find((b) => b.id === item.id)}
          pattern={patterns && (item.group ? groupPattern(patterns, item) : patterns.find((x) => x.id === item.id))}
          now={now}
        />
      ))}
      {(usage?.car || carW > 0) && (
        <LitTile
          color={CAR_COLOR}
          icon="car"
          name="Car"
          link={(props) => <Link to="/ev" {...props} />}
          share={homeW && split ? split.car / homeW : null}
          value={split && split.car > 0 ? kW(split.car) : "0 W"}
          muted={!split || split.car <= 0}
          spark={usage?.car ? <HourSpark kwh={usage.car.kwh} t={usage.t} now={now} color={CAR_COLOR} /> : null}
          foot={split && split.car > 0 ? "Charging" : "Not charging"}
          footRight={
            usage?.car
              ? `${kWh(usage.car.total)} today${usage.car.solar_share != null && usage.car.total > 0.05 ? `, ${pct(usage.car.solar_share * 100)} sun` : ""}`
              : undefined
          }
        />
      )}
      {split && split.other > 0 && (
        <LitTile
          color={OTHER_COLOR}
          icon="plug"
          name="Everything else"
          share={homeW ? split.other / homeW : null}
          value={kW(split.other)}
          dashed
          spark={usage ? <HourSpark kwh={usage.other} t={usage.t} now={now} color={COLOR.inkMuted} dashed /> : null}
          foot="Not on a plug"
          footRight={usage?.total.other != null ? `${kWh(usage.total.other)} today` : undefined}
        />
      )}
      {standby?.home_w != null && (
        <LitTile
          color={COLOR.inkMuted}
          icon="moon"
          name="Always on"
          share={null}
          value={kW(standby.home_w)}
          foot={standby.yearly_cost != null ? `About ${dollars(standby.yearly_cost)} a year` : "Overnight, every night"}
          footRight={standby.measured_w > 0 ? `${kW(standby.measured_w)} on plugs` : undefined}
        />
      )}
    </div>
  );

  const head = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <TitleBlock
        title="Rooms now"
        sub={[
          on.length ? `${on.length} drawing power now` : "Nothing drawing power now",
          offline.length ? `${offline.length} offline` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      />
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        {hasRooms && !framed && (
          <Segmented
            label="Show"
            options={[
              { value: "rooms", label: "By room" },
              { value: "devices", label: "By device" },
            ]}
            value={view}
            onChange={(v) => {
              setView(v);
              store.set(STORE_HOME_VIEW, v);
            }}
          />
        )}
        {split && homeW ? (
          <div className="flex flex-none flex-col items-end gap-0.5" title="What the plugs, appliances and car read">
            <span className="text-xs text-ink-faint">Measured</span>
            <span className="text-[28px] leading-8 font-light tracking-[-1px] tabular-nums">
              {pct(Math.min(1, measured / homeW) * 100)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );

  if (load === undefined && !devices.length) return <Skeleton className="h-[260px] rounded-3xl" />;
  return framed ? (
    <Card className="h-full gap-4">
      {head}
      {tiles}
    </Card>
  ) : (
    <section aria-label="Rooms now" className="flex flex-col gap-4">
      <div className="pt-2">{head}</div>
      {tiles}
    </section>
  );
}
