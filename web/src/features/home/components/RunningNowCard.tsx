import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { hhmm } from "~/features/common/formatting/utils/date";
import { kWh } from "~/features/common/formatting/utils/number";
import { alpha } from "~/features/common/theme/utils/colors";
import { Card } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { homeQuery } from "~/features/home/api";
import { runningOf } from "~/features/home/components/RoomTiles";
import type { HomeDevice } from "~/features/home/types";
import { deviceColors, deviceIcon, ESTIMATED, watts } from "~/features/home/utils";

/** How long a run has gone, in words: "42 min", "1 h 5 min". */
const lasted = (secs: number) => {
  const m = Math.max(1, Math.round(secs / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
};

/** A ring of how far through its run an appliance is, with how long is left in it (or, not knowing, how long it's run). */
function RunRing({
  progress,
  color,
  compact,
  children,
}: {
  progress: number | null;
  color: string;
  compact: boolean;
  children: ReactNode;
}) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className={cn("relative flex-none", compact ? "size-14" : "size-[124px] max-sm:size-[104px]")}>
      <svg viewBox="0 0 124 124" className="size-full -rotate-90" aria-hidden>
        <circle cx="62" cy="62" r={r} fill="none" strokeWidth="10" className="stroke-track" />
        {progress != null ? (
          <circle
            cx="62"
            cy="62"
            r={r}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${Math.max(0.02, Math.min(1, progress)) * c} ${c}`}
            className="transition-[stroke-dasharray] duration-700 ease-out-soft"
            style={{ stroke: color }}
          />
        ) : (
          // How long is left isn't known: an arc going round, as a run that's under way.
          <circle
            cx="62"
            cy="62"
            r={r}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${c * 0.22} ${c}`}
            className="origin-center animate-[spin_3s_linear_infinite] [transform-box:fill-box] motion-reduce:animate-none"
            style={{ stroke: color }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

/**
 * One appliance mid-run: its ring, name, phase, when it's done, what it's drawing and what the run has used so far.
 * `compact` (a short dashboard card): a small ring, and the name, phase and when it's done on two lines.
 */
function Running({ d, color, compact }: { d: HomeDevice; color: string; compact: boolean }) {
  const run = runningOf([d])!;
  const n = d.now!;
  const soFar = n.estimate && !(n.run && n.run.kwh > 0) ? n.estimate.kwh_so_far : n.run?.kwh;
  return (
    <li
      className={cn("flex min-w-0 items-center rounded-[20px]", compact ? "gap-3 px-2 py-1" : "gap-5 p-4 max-sm:gap-4")}
      style={{ backgroundImage: `radial-gradient(circle at 0% 50%, ${alpha(color, 0.18)}, transparent 70%)` }}
    >
      <RunRing progress={run.progress} color={color} compact={compact}>
        {run.left != null ? (
          <>
            <span
              className={cn(
                "font-light tabular-nums",
                compact ? "text-[17px] leading-5" : "text-[30px] leading-8 tracking-[-1px]",
              )}
            >
              {run.left}
            </span>
            <span className={cn("text-ink-faint", compact ? "text-[9.5px] leading-3" : "text-[11px]")}>
              {compact ? "min" : "min left"}
            </span>
          </>
        ) : (
          <span className="flex flex-col items-center" style={{ color }}>
            <Icon name={deviceIcon(d)} size={compact ? 18 : 26} />
          </span>
        )}
      </RunRing>
      {compact ? (
        <div className="flex min-w-0 flex-1 flex-col">
          <Link
            to="/home/$device"
            params={{ device: String(d.id) }}
            className="truncate text-sm font-medium text-ink no-underline hover:underline"
          >
            {d.name}
          </Link>
          <span className="truncate text-xs text-ink-muted tabular-nums">
            {[run.phase, run.done != null ? `done about ${hhmm(run.done)}` : null].filter(Boolean).join(" · ")}
          </span>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Link
            to="/home/$device"
            params={{ device: String(d.id) }}
            className="truncate text-[17px] font-medium text-ink no-underline hover:underline"
          >
            {d.name}
          </Link>
          <div className="flex flex-wrap gap-1.5">
            <span
              className="rounded-full px-2 py-0.5 text-[11.5px] font-medium"
              style={{ background: alpha(color, 0.2), color: `color-mix(in srgb, ${color} 60%, white)` }}
            >
              {run.phase}
            </span>
            {n.program && n.program !== run.phase && (
              <span className="rounded-full bg-fg/6 px-2 py-0.5 text-[11.5px] text-ink-muted">{n.program}</span>
            )}
          </div>
          <span
            className="text-xs leading-[18px] text-ink-faint tabular-nums"
            title={n.estimated ? ESTIMATED : undefined}
          >
            {run.done != null
              ? `Done about ${hhmm(run.done)}`
              : n.run
                ? `Running ${lasted(n.at - n.run.start)}`
                : "Running"}
            <br />
            {[
              n.power_w != null && n.power_w >= 2 ? `${watts(n.power_w, n.estimated)} now` : null,
              soFar ? `${n.estimated ? "≈" : ""}${kWh(soFar)} so far` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      )}
    </li>
  );
}

/**
 * While an appliance is running: each one with a ring of how far through its run it is and how long is left, its
 * phase, when it'll be done, what it's drawing and what the run has used so far (estimated, for an appliance that
 * doesn't report its power and has its estimate on). While nothing is, nothing at all, or (`quiet`, where its place is
 * kept, as on a dashboard) a line saying so.
 */
export function RunningNowCard({
  quiet = false,
  compact = false,
  className,
}: {
  quiet?: boolean;
  /** Short (a dashboard card two rows high): a small heading and a small ring each. */
  compact?: boolean;
  className?: string;
}) {
  const { data } = useQuery(homeQuery);
  const devices = data?.devices ?? [];
  const running = devices.filter((d) => !d.hidden && d.now?.running && !d.now.stale && d.now.online);
  if (!running.length && !quiet) return null;
  const colors = deviceColors(devices, data?.rooms);
  return (
    <Card aria-labelledby="h-running" className={cn("h-full gap-3", className)}>
      <div className="flex items-center justify-between gap-3">
        {compact ? (
          <span id="h-running" className="text-[13px] text-ink-muted">
            Running now
          </span>
        ) : (
          <h2 id="h-running">Running now</h2>
        )}
        <Link to="/home" className="text-[13px] text-brand no-underline hover:underline">
          Home
        </Link>
      </div>
      {!running.length && <span className="text-[13px] text-ink-faint">Nothing's running right now.</span>}
      <ul
        className={cn(
          "m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-2 p-0",
          compact ? "-mx-2" : "-mx-4",
        )}
      >
        {running.map((d) => (
          <Running key={d.id} d={d} color={colors.get(d.id) ?? "var(--color-brand)"} compact={compact} />
        ))}
      </ul>
    </Card>
  );
}
