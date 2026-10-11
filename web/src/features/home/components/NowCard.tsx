import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { hhmm } from "~/features/common/formatting/utils/date";
import { DASH, kW, pct } from "~/features/common/formatting/utils/number";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { useHomeCharging } from "~/features/ev/hooks";
import type { HomeDevice } from "~/features/home/types";
import {
  CAR_COLOR,
  ESTIMATED,
  homeItems,
  liveBreakdown,
  OTHER_COLOR,
  watts,
  type HomeItem,
} from "~/features/home/utils";

const live = (d: HomeDevice) => !!d.now && d.now.online && !d.now.stale;

/** What's running in a room or on a device, in a line: "Rinse · 12 min left, done about 10:42", with the appliance's
 * name first in a room. */
function runningLine(item: HomeItem): string | null {
  const on = item.members.filter((d) => live(d) && d.now!.running);
  if (!on.length) return null;
  return on
    .map((d) => {
      const n = d.now!;
      const left = n.remaining_min ? Math.round(n.remaining_min) : null;
      return [
        item.group ? d.name : null,
        n.phase ?? "Running",
        left != null ? `${left} min left, done about ${hhmm(n.at + left * 60)}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    })
    .join("; ");
}

/** "a, b and c". */
const listed = (parts: string[]) =>
  parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

type Row = {
  key: string;
  name: ReactNode;
  label: string;
  w: number | null;
  color: string;
  sub?: string | null;
  estimated?: boolean;
};

/**
 * The home right now: what it's drawing, split between its rooms and devices (as their plugs and appliances read
 * them), the car charging and everything else, the most first, with what's running and how long it has left; then
 * what's idle or offline. It follows the plugs (read every 15 seconds) and the inverter (every minute).
 */
export function NowCard({
  devices,
  colors,
  load,
}: {
  devices: HomeDevice[];
  colors: Map<number, string>;
  /** What the home is drawing, from the inverter (W). */
  load: number | null | undefined;
}) {
  const carW = useHomeCharging();
  const split = liveBreakdown(devices, load, { carW });
  const items = homeItems(devices);
  const home = Math.max(0, load ?? 0);
  const name = (item: HomeItem) => item.group ?? item.members[0].name;
  const link = (item: HomeItem, text: string) => {
    const cls = "truncate text-ink no-underline hover:underline";
    return item.group ? (
      <Link to="/home/rooms/$room" params={{ room: item.group }} className={cls}>
        {text}
      </Link>
    ) : (
      <Link to="/home/$device" params={{ device: String(item.id) }} className={cls}>
        {text}
      </Link>
    );
  };

  const drawingIds = new Set(split?.parts.map((p) => p.id));
  const rows: Row[] = [
    ...(split?.parts ?? []).map((p): Row => {
      const item = items.find((i) => i.id === p.id)!;
      return {
        key: String(p.id),
        name: link(item, p.name),
        label: p.name,
        w: p.w,
        color: colors.get(p.id) ?? OTHER_COLOR,
        sub: runningLine(item),
        estimated: p.estimated,
      };
    }),
    // Running without saying what it draws (and no estimate): still running, so listed, without a figure.
    ...items
      .filter((i) => !drawingIds.has(i.id) && runningLine(i))
      .map((i) => ({
        key: String(i.id),
        name: link(i, name(i)),
        label: name(i),
        w: null,
        color: colors.get(i.id) ?? OTHER_COLOR,
        sub: runningLine(i),
      })),
    ...(split && split.car > 0
      ? [
          {
            key: "car",
            name: (
              <Link to="/ev" className="truncate text-ink no-underline hover:underline">
                Car charging
              </Link>
            ),
            label: "Car charging",
            w: split.car,
            color: CAR_COLOR,
          },
        ]
      : []),
    ...(split && split.other > 0
      ? [
          {
            key: "other",
            name: <span className="truncate text-ink-muted">Everything else</span>,
            label: "Everything else",
            w: split.other,
            color: OTHER_COLOR,
          },
        ]
      : []),
  ];
  const listedIds = new Set(rows.map((r) => r.key));
  const quiet = items.filter((i) => !listedIds.has(String(i.id)));
  const offline = quiet.filter((i) => i.members.every((d) => !live(d))).map(name);
  const idle = quiet.filter((i) => i.members.some(live)).map(name);
  const measured = split ? split.measured + split.car : 0;
  const bar = rows.filter((r) => r.w != null && r.w > 0);

  return (
    <Card aria-labelledby="h-now" className="gap-4">
      <div className="flex items-end justify-between gap-3">
        <TitleBlock
          id="h-now"
          className="min-w-0 flex-1"
          title="Right now"
          sub="What each room is drawing this minute"
        />
        {split && home > 0 && (
          <div className="flex flex-none flex-col items-end gap-0.5" title="What the plugs, appliances and car read">
            <span className="text-xs text-ink-faint">Measured</span>
            <span className="text-[28px] leading-8 font-light tracking-[-1px] tabular-nums">
              {pct(Math.min(1, measured / home) * 100)}
            </span>
          </div>
        )}
      </div>
      {load == null ? (
        <Skeleton className="h-[180px] rounded-2xl" />
      ) : (
        <>
          {bar.length > 0 && (
            <div
              className="flex h-2 origin-left animate-fill-x gap-[3px]"
              role="img"
              aria-label={bar.map((r) => `${r.label} ${kW(r.w!)}`).join(", ")}
            >
              {bar.map((r) => (
                <span
                  key={r.key}
                  title={`${r.label} · ${kW(r.w!)}`}
                  className="min-w-1 rounded-full transition-[flex-grow] duration-1000 ease-(--ease-out-soft)"
                  style={{ flexGrow: r.w! / Math.max(home, measured), background: r.color }}
                />
              ))}
            </div>
          )}
          {rows.length > 0 ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {rows.map((r, i) => (
                <li
                  key={r.key}
                  className="flex animate-rise items-center gap-3 border-t border-line-subtle py-2.5 text-sm tabular-nums first:border-t-0 first:pt-0"
                  style={{ animationDelay: `${80 + i * 25}ms` }}
                >
                  <span className="size-2 flex-none rounded-full" style={{ background: r.color }} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {r.name}
                    {r.sub && <span className="truncate text-xs text-ink-muted">{r.sub}</span>}
                  </div>
                  <span className="w-10 flex-none text-right text-xs text-ink-faint">
                    {r.w != null && home > 0 ? (r.w / home < 0.005 ? "<1%" : pct(Math.min(1, r.w / home) * 100)) : ""}
                  </span>
                  <b
                    className="w-16 flex-none text-right font-semibold whitespace-nowrap"
                    title={r.estimated ? ESTIMATED : undefined}
                  >
                    {r.w == null ? DASH : watts(r.w, r.estimated)}
                  </b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[13px] text-ink-muted">
              {devices.some(live)
                ? "Nothing your plugs measure is drawing power right now."
                : "None of your plugs or appliances has a fresh reading right now."}
            </p>
          )}
          {(idle.length > 0 || offline.length > 0) && (
            <p className="m-0 text-xs text-pretty text-ink-faint">
              {[
                idle.length ? `${listed(idle)} ${idle.length === 1 ? "is" : "are"} idle` : null,
                offline.length ? `${listed(offline)} ${offline.length === 1 ? "is" : "are"} offline` : null,
              ]
                .filter(Boolean)
                .join(", and ")}
              .
            </p>
          )}
        </>
      )}
    </Card>
  );
}
