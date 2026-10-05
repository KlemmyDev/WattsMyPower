import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { duration, hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { kW, kWh, money } from "~/features/common/formatting/utils/number";
import { alpha } from "~/features/common/theme/utils/colors";
import { Button } from "~/features/common/ui/components/Button";
import { Card } from "~/features/common/ui/components/Card";
import { HelpText } from "~/features/common/ui/components/Field";
import { Icon } from "~/features/common/ui/components/Icon";
import { Pill } from "~/features/common/ui/components/Pill";
import { Switch } from "~/features/common/ui/components/Switch";
import { cn } from "~/features/common/ui/utils";
import { useHomeChange } from "~/features/home/hooks";
import type { BestTime, DevicePattern, HomeDevice, HomeUsage } from "~/features/home/types";
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

const PROTECTED = new Set(["fridge", "freezer"]);

/** A device's name, linking to its page (its runs, and its use week by week). */
function DeviceLink({ id, children }: { id: number; children: React.ReactNode }) {
  return (
    <Link to="/home/$device" params={{ device: String(id) }} className="text-inherit no-underline hover:underline">
      {children}
    </Link>
  );
}

/**
 * Switching a device on and off. On is at once; off asks first (a fridge or freezer more firmly, as off it stops keeping
 * food cold). Shown only while the device can be reached and says whether it's on.
 */
function Power({ device, kindLabel }: { device: HomeDevice; kindLabel: string }) {
  const { switch: change } = useHomeChange();
  const [asking, setAsking] = useState(false);
  const now = device.now;
  if (!device.can_switch || !now || now.stale || !now.online || now.switched_on == null) return null;
  const on = now.switched_on;
  const guarded = PROTECTED.has(device.kind);
  const send = (next: boolean) =>
    change.mutate({ id: device.id, on: next, confirm: !next && guarded }, { onSuccess: () => setAsking(false) });
  return (
    <div className="flex flex-col items-end gap-2">
      <Switch
        on={on}
        label={on ? `Switch ${device.name} off` : `Switch ${device.name} on`}
        disabled={change.isPending}
        onChange={(next) => (next ? send(true) : setAsking(true))}
      />
      {asking && (
        <div className="flex max-w-[260px] flex-col items-end gap-2 text-right">
          <span className="text-[13px] text-pretty text-ink-muted">
            {guarded
              ? `It's set as a ${kindLabel.toLowerCase()}: switched off, it stops keeping food cold.`
              : `Switch ${device.name} off?`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="muted-link" size="sm" onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button variant="outline" size="sm" disabled={change.isPending} onClick={() => send(false)}>
              {change.isPending ? "Switching off…" : guarded ? "Switch off anyway" : "Switch off"}
            </Button>
          </div>
        </div>
      )}
      {change.isError && <HelpText tone="bad">{errorMessage(change.error)}</HelpText>}
    </div>
  );
}

/** What it used in the period shown, its share of the home's, and its habits (and last run, if it runs in cycles). */
function Use({
  used,
  before,
  pattern,
  cycles,
  color,
  home,
  rangeLabel,
  beforeLabel,
  lastRun,
  best,
}: {
  used: Used | undefined;
  /** What it used in the period before, of the same length (undefined: not compared). */
  before: number | undefined;
  pattern: DevicePattern | undefined;
  cycles: boolean;
  color: string;
  home: number | null;
  rangeLabel: string;
  /** The period before, in words: "the 7 days before". */
  beforeLabel: string;
  lastRun: HomeDevice["last_run"];
  best: BestTime | undefined;
}) {
  const habit = habitLine(pattern, cycles);
  const total = used?.total ?? 0;
  const change = compared(total, before);
  return (
    <>
      <dl className="m-0 grid grid-cols-3 gap-3 border-y border-line-subtle py-3 tabular-nums max-xs:grid-cols-2">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-ink-muted">Used {rangeLabel}</dt>
          <dd className="m-0 text-lg font-semibold">{kWh(total)}</dd>
          {used && total > 0 && (
            <dd className="m-0 text-xs text-ink-muted">
              {money(used.cost)}
              {used.solar_share != null && ` · ${Math.round(used.solar_share * 100)}% solar`}
            </dd>
          )}
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
        {change && (
          <span>
            <b className={cn("font-medium", change.up ? "text-ink" : "text-good")}>{change.text}</b> on {beforeLabel}
          </span>
        )}
        {habit && <span>{habit}</span>}
        {cycles && lastRun && <span>Last run {runLine(lastRun)}</span>}
        {best && <BestTimeLine best={best} />}
      </div>
    </>
  );
}

/** How much more or less than before: "↑ 24% more", "↓ 10% less", "about the same". Null without enough to go on. */
function compared(now: number, before: number | undefined): { text: string; up: boolean } | null {
  if (before == null || (before < 0.05 && now < 0.05)) return null;
  if (before < 0.05) return { text: "New", up: true };
  const change = (now - before) / before;
  if (Math.abs(change) < 0.05) return { text: "About the same", up: false };
  const pct = Math.round(Math.abs(change) * 100);
  return change > 0 ? { text: `↑ ${pct}% more`, up: true } : { text: `↓ ${pct}% less`, up: false };
}

/** "today", "tomorrow" or the weekday a time falls on. */
function dayWord(ts: number) {
  const day = (t: number) => new Date(t * 1000).toDateString();
  const now = Date.now() / 1000;
  if (day(ts) === day(now)) return "today";
  if (day(ts) === day(now + 86400)) return "tomorrow";
  return shortDay.format(new Date(ts * 1000));
}

/** When to run it next: "Best run today 10:30–11:45, all on spare solar", or the cheapest time from the grid. */
function BestTimeLine({ best }: { best: BestTime }) {
  const when = `${dayWord(best.start)} ${hhmm(best.start)}–${hhmm(best.end)}`;
  const solar = Math.round(best.solar_share * 100);
  const how =
    best.why === "cheapest"
      ? `the cheapest from the grid, about ${money(best.cost)}`
      : solar >= 95
        ? "all on spare solar"
        : `${solar}% on spare solar, about ${money(best.cost)} from the grid`;
  return (
    <span className="flex items-center gap-1.5">
      <Icon name={best.why === "cheapest" ? "clock" : "sun"} size={14} className="flex-none text-solar" />
      <span>
        Best time to run: <b className="font-medium text-ink">{when}</b>, {how}
      </span>
    </span>
  );
}

/** One word for how devices are: running if any is; else offline, or off, if they all are; else idle. */
function state(devices: HomeDevice[]) {
  if (devices.some((d) => d.now?.running && !d.now.stale)) return "Running";
  if (devices.every((d) => d.now?.online === false)) return "Offline";
  if (devices.every((d) => d.now?.switched_on === false)) return "Off";
  return "Idle";
}

/** One device: what it's doing now, what it used in the period shown, its habits, and its last run. */
export function DeviceCard({
  device,
  used,
  before,
  pattern,
  cycles,
  kindLabel,
  color,
  home,
  rangeLabel,
  beforeLabel,
  best,
}: {
  device: HomeDevice;
  used: Used | undefined;
  before: number | undefined;
  pattern: DevicePattern | undefined;
  cycles: boolean;
  kindLabel: string;
  color: string;
  home: number | null;
  rangeLabel: string;
  beforeLabel: string;
  best: BestTime | undefined;
}) {
  const now = nowLine(device);
  const details = Object.entries(device.now?.details ?? {});
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
            <h3 className="m-0 truncate text-[17px] font-semibold">
              <DeviceLink id={device.id}>{device.name}</DeviceLink>
            </h3>
            <Pill tone={now.running ? "good" : "neutral"} size="sm">
              {state([device])}
            </Pill>
          </div>
          <span className="truncate text-[13px] text-ink-muted">
            {[kindLabel, device.model].filter(Boolean).join(" · ")}
          </span>
        </div>
        <Power device={device} kindLabel={kindLabel} />
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

      <Use
        used={used}
        before={before}
        pattern={pattern}
        cycles={cycles}
        color={color}
        home={home}
        rangeLabel={rangeLabel}
        beforeLabel={beforeLabel}
        lastRun={device.last_run}
        best={best}
      />
    </Card>
  );
}

/**
 * A group of devices as one (the plugs in a room): what they used together, and their habits together; then each of
 * them with what it's doing now, and its switch.
 */
export function GroupCard({
  name,
  members,
  used,
  before,
  pattern,
  cycles,
  kindLabels,
  color,
  home,
  rangeLabel,
  beforeLabel,
}: {
  name: string;
  members: HomeDevice[];
  used: Used | undefined;
  before: number | undefined;
  pattern: DevicePattern | undefined;
  cycles: boolean;
  kindLabels: Map<string, string>;
  color: string;
  home: number | null;
  rangeLabel: string;
  beforeLabel: string;
}) {
  const kinds = new Set(members.map((d) => d.kind));
  const kind = kinds.size === 1 ? members[0].kind : null;
  const word = state(members);
  const read = members.filter((d) => d.now && !d.now.stale && d.now.online && d.now.power_w != null);
  const power = read.reduce((a, d) => a + d.now!.power_w!, 0);
  const lastRun = members
    .map((d) => d.last_run)
    .filter((r) => r != null)
    .sort((a, b) => b.start - a.start)[0];
  return (
    <Card aria-label={name} className="col-span-6 gap-4 max-lg:col-span-12">
      <div className="flex items-start gap-3">
        <span
          className="flex size-11 flex-none items-center justify-center rounded-full"
          style={{ background: alpha(color, 0.16), color }}
        >
          <Icon name={kind ? kindIcon(kind) : "plug"} size={22} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="m-0 truncate text-[17px] font-semibold">{name}</h3>
            <Pill tone={word === "Running" ? "good" : "neutral"} size="sm">
              {word}
            </Pill>
          </div>
          <span className="truncate text-[13px] text-ink-muted">
            {[members.length === 1 ? "Group" : `Group of ${members.length}`, kind ? kindLabels.get(kind) : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        {read.length > 0 && power >= 2 && (
          <span className="text-sm font-medium whitespace-nowrap tabular-nums">Using {kW(power)}</span>
        )}
      </div>

      <ul className="m-0 flex list-none flex-col p-0">
        {members.map((d) => {
          const now = nowLine(d);
          return (
            <li
              key={d.id}
              className="flex items-start gap-3 border-t border-line-subtle py-2.5 first:border-t-0 first:pt-0"
            >
              <div className="flex min-h-6 min-w-0 flex-1 flex-col justify-center">
                <span className="truncate text-sm font-medium">
                  <DeviceLink id={d.id}>{d.name}</DeviceLink>
                </span>
                <span className={cn("truncate text-[13px]", now.running ? "text-good" : "text-ink-muted")}>
                  {now.text}
                  {d.now?.running && d.now.program ? ` · ${d.now.program}` : ""}
                </span>
              </div>
              <Power device={d} kindLabel={kindLabels.get(d.kind) ?? "Device"} />
            </li>
          );
        })}
      </ul>

      <Use
        used={used}
        before={before}
        pattern={pattern}
        cycles={cycles}
        color={color}
        home={home}
        rangeLabel={rangeLabel}
        beforeLabel={beforeLabel}
        lastRun={lastRun ?? null}
        best={undefined}
      />
    </Card>
  );
}
