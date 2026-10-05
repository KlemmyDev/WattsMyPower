import { duration, hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { kWh } from "~/features/common/formatting/utils/number";
import { alpha } from "~/features/common/theme/utils/colors";
import { Card } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { Pill } from "~/features/common/ui/components/Pill";
import { cn } from "~/features/common/ui/utils";
import type { DevicePattern, HomeDevice, HomeUsage } from "~/features/home/types";
import { habitLine, kindIcon, nowLine, WEEKDAY_SHORT } from "~/features/home/utils";

type Used = HomeUsage["devices"][number];

/** A day and time a run started, and how it went: "Sat 4 Oct, 08:30 · 76 min · 0.67 kWh". */
function runLine(run: NonNullable<HomeDevice["last_run"]>) {
  const d = new Date(run.start * 1000);
  return [
    `${shortDay.format(d)}, ${hhmm(run.start)}`,
    run.end ? duration(run.end - run.start) : null,
    run.kwh > 0 ? kWh(run.kwh) : null,
    run.program,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The week at a glance, Monday to Sunday: for an appliance that runs in cycles, how many runs started on each day
 * (the days it usually runs filled in); otherwise what it uses on an average one.
 */
function Week({ pattern, cycles, color }: { pattern: DevicePattern; cycles: boolean; color: string }) {
  const values = cycles ? pattern.run_days : pattern.by_weekday.map((v) => v ?? 0);
  const top = Math.max(...values, cycles ? 1 : 0.001);
  const usual = (i: number) => cycles && pattern.weekdays_seen[i] > 0 && values[i] / pattern.weekdays_seen[i] >= 0.5;
  return (
    <div className="flex items-end gap-1.5" aria-hidden>
      {values.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <div className="flex h-9 w-full items-end">
            <span
              className="w-full rounded-t-[3px]"
              style={{
                height: `${Math.max(v > 0 ? 8 : 0, (v / top) * 100)}%`,
                background: usual(i) || !cycles ? color : alpha(color, 0.4),
              }}
            />
          </div>
          <span className={cn("font-mono text-[10px]", usual(i) ? "text-ink" : "text-ink-faint")}>
            {WEEKDAY_SHORT[i].slice(0, 2)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** One device: what it's doing now, what it used in the period shown, its habits, and its last run. */
export function DeviceCard({
  device,
  used,
  pattern,
  cycles,
  kindLabel,
  color,
  home,
  rangeLabel,
}: {
  device: HomeDevice;
  used: Used | undefined;
  pattern: DevicePattern | undefined;
  cycles: boolean;
  kindLabel: string;
  color: string;
  home: number | null;
  rangeLabel: string;
}) {
  const now = nowLine(device);
  const habit = habitLine(pattern, cycles);
  const details = Object.entries(device.now?.details ?? {});
  const total = used?.total ?? 0;
  return (
    <Card aria-label={device.name} className="col-span-6 gap-4 max-lg:col-span-12">
      <div className="flex items-start gap-3">
        <span
          className="flex size-11 flex-none items-center justify-center rounded-full"
          style={{ background: alpha(color, 0.16), color }}
        >
          <Icon name={kindIcon(device.kind)} size={22} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="m-0 truncate text-[17px] font-semibold">{device.name}</h3>
            <Pill tone={now.running ? "good" : "neutral"} size="sm">
              {now.running ? "Running" : device.now?.online === false ? "Offline" : "Idle"}
            </Pill>
          </div>
          <span className="truncate text-[13px] text-ink-muted">
            {[kindLabel, device.model].filter(Boolean).join(" · ")}
          </span>
        </div>
      </div>

      {/* What it's doing, unless the pill has said it all ("Idle", "Offline"). */}
      {now.text !== "Idle" && now.text !== "Offline" && (
        <div className="flex items-center gap-2 text-sm">
          {now.running && <Icon name="clock" size={16} className="text-good" />}
          <span className={now.running ? "font-medium" : "text-ink-muted"}>{now.text}</span>
          {device.now?.running && device.now.program && <span className="text-ink-muted">· {device.now.program}</span>}
        </div>
      )}
      {details.length > 0 && (
        <div className="-mt-1 flex flex-wrap gap-1.5">
          {details.map(([k, v]) => (
            <span key={k} className="rounded-full bg-surface-raised px-2.5 py-1 text-xs text-ink-muted">
              {k} <b className="font-medium text-ink">{v}</b>
            </span>
          ))}
        </div>
      )}

      <dl className="m-0 grid grid-cols-3 gap-3 border-y border-line-subtle py-3 tabular-nums max-xs:grid-cols-2">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-ink-muted">Used {rangeLabel}</dt>
          <dd className="m-0 text-lg font-semibold">{kWh(total)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-ink-muted">Of home use</dt>
          <dd className="m-0 text-lg font-semibold">{home ? `${Math.round((total / home) * 1000) / 10}%` : "—"}</dd>
        </div>
        {cycles ? (
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-ink-muted">Runs</dt>
            <dd className="m-0 text-lg font-semibold">
              {used?.runs ?? 0}
              {used?.run_kwh != null && (
                <span className="ml-1.5 text-xs font-normal text-ink-muted">{kWh(used.run_kwh)} each</span>
              )}
            </dd>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-ink-muted">A day, usually</dt>
            <dd className="m-0 text-lg font-semibold">{kWh(pattern?.daily_kwh)}</dd>
          </div>
        )}
      </dl>

      {pattern && pattern.days >= 7 && <Week pattern={pattern} cycles={cycles} color={color} />}
      <div className="flex flex-col gap-1 text-[13px] text-ink-muted">
        {habit && <span>{habit}</span>}
        {cycles && device.last_run && <span>Last run {runLine(device.last_run)}</span>}
      </div>
    </Card>
  );
}
