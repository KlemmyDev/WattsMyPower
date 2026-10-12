import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { duration, hhmm, hourLabel, shortDay } from "~/features/common/formatting/utils/date";
import { kWh, money } from "~/features/common/formatting/utils/number";
import { alpha } from "~/features/common/theme/utils/colors";
import { Button } from "~/features/common/ui/components/Button";
import { Card } from "~/features/common/ui/components/Card";
import { HelpText } from "~/features/common/ui/components/Field";
import { hasIcon, Icon } from "~/features/common/ui/components/Icon";
import { Switch } from "~/features/common/ui/components/Switch";
import { cn } from "~/features/common/ui/utils";
import { useNow } from "~/features/common/time/hooks";
import { addDays, midnight, nowS, sameDay } from "~/features/common/time/utils";
import { useHomeChange } from "~/features/home/hooks";
import { LookButton } from "~/features/home/components/LookPicker";
import type { BestTime, DevicePattern, HomeDevice, HomeUsage, RoomLook, Saving } from "~/features/home/types";
import {
  defaultDeviceIcon,
  defaultRoomIcon,
  deviceIcon,
  drawing,
  ESTIMATED,
  habitLine,
  nowLine,
  watts,
  WEEKDAY_SHORT,
} from "~/features/home/utils";

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
              ? `It's set as a ${kindLabel.toLowerCase()}. Switched off, it stops keeping food cold.`
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
  saving,
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
  saving?: Saving;
}) {
  const habit = habitLine(pattern, cycles);
  const total = used?.total ?? 0;
  const change = compared(total, before);
  return (
    // At the foot of the card, so the figures line up with the cards beside it.
    <div className="mt-auto flex flex-col gap-3.5">
      <dl className="m-0 grid grid-cols-3 gap-3 border-t border-line-subtle pt-3.5 tabular-nums max-xs:grid-cols-2">
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
        {saving && saving.saved >= 0.5 && (
          <span>
            Running around {hourLabel(saving.best_hour)} instead of {hourLabel(saving.usual_hour)} would have saved{" "}
            <b className="font-medium text-ink">{money(saving.saved)}</b> on its last {saving.runs} runs.
          </span>
        )}
      </div>
    </div>
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
  const today = midnight(nowS());
  if (sameDay(ts, today)) return "today";
  if (sameDay(ts, addDays(today, 1))) return "tomorrow";
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

/** What its spare-solar rule is doing: "Runs on spare solar · switched on at 10:42 (spare solar)". */
function RuleLine({ device }: { device: HomeDevice }) {
  const r = device.rule!;
  const now = useNow(60_000);
  const paused = r.paused_until != null && r.paused_until > now;
  const last = r.last && `switched ${r.last.on ? "on" : "off"} at ${hhmm(r.last.at)} (${r.last.why})`;
  return (
    <div className="-mt-1 flex items-center gap-1.5 text-[13px] text-ink-muted">
      <Icon name="sun" size={14} className="flex-none text-solar" />
      <span>
        {!r.enabled
          ? "Its spare-solar rule is off"
          : paused
            ? "Switched by hand, so its spare-solar rule waits until tomorrow"
            : ["Runs on spare solar", last].filter(Boolean).join(" · ")}
      </span>
    </div>
  );
}

/** Whether devices are drawing power (or running), and whether they're all offline, for their icon. */
function lights(devices: HomeDevice[]) {
  const live = (d: HomeDevice) => !!d.now && d.now.online && !d.now.stale;
  return {
    lit: devices.some((d) => live(d) && (d.now!.running || drawing(d) != null)),
    off: devices.every((d) => !live(d)),
  };
}

/** A card's head: its icon (which changes its look), its name, what it's doing, and what's on the right. */
function Head({
  look,
  name,
  status,
  tone,
  right,
}: {
  look: ReactNode;
  name: ReactNode;
  status: ReactNode;
  tone: "good" | "ink" | "muted";
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3.5">
      {look}
      <div className="flex min-h-12 min-w-0 flex-1 flex-col justify-center gap-0.5">
        <h3 className="m-0 truncate text-[17px] leading-6 font-semibold">{name}</h3>
        <span
          className={cn(
            "truncate text-[13px] tabular-nums",
            tone === "good" ? "font-medium text-good" : tone === "ink" ? "text-ink" : "text-ink-muted",
          )}
        >
          {status}
        </span>
      </div>
      {right}
    </div>
  );
}

const CARD = "h-full gap-4 p-6 max-sm:p-5";

/** One device: what it's doing now, what it used in the period shown, its habits, and its last run. Its icon changes
 * its colour and icon. */
export function DeviceCard({
  device,
  used,
  before,
  pattern,
  cycles,
  kindLabel,
  color,
  givenColor,
  home,
  rangeLabel,
  beforeLabel,
  best,
  saving,
}: {
  device: HomeDevice;
  used: Used | undefined;
  before: number | undefined;
  pattern: DevicePattern | undefined;
  cycles: boolean;
  kindLabel: string;
  color: string;
  /** Its colour without one chosen (its room's, or its slot's). */
  givenColor: string;
  home: number | null;
  rangeLabel: string;
  beforeLabel: string;
  best: BestTime | undefined;
  saving?: Saving;
}) {
  const { deviceLook } = useHomeChange();
  const now = nowLine(device);
  const { lit, off } = lights([device]);
  const details = Object.entries(device.now?.details ?? {});
  const switchable = device.can_switch && device.now?.switched_on != null && !off;
  const w = drawing(device);
  return (
    <Card aria-label={device.name} className={CARD}>
      <Head
        look={
          <LookButton
            name={device.name}
            icon={deviceIcon(device)}
            color={color}
            lit={lit}
            off={off}
            look={{ color: device.color ?? null, icon: device.icon ?? null }}
            given={{ color: givenColor, icon: defaultDeviceIcon(device) }}
            onPick={(change) => deviceLook.mutate({ id: device.id, ...change })}
            pending={deviceLook.isPending}
            error={deviceLook.error}
          />
        }
        name={
          <span title={[kindLabel, device.model].filter(Boolean).join(" · ")}>
            <DeviceLink id={device.id}>{device.name}</DeviceLink>
          </span>
        }
        status={
          <>
            {now.text}
            {device.now?.running && device.now.program ? ` · ${device.now.program}` : ""}
          </>
        }
        tone={now.running ? "good" : w != null ? "ink" : "muted"}
        right={
          switchable ? (
            <Power device={device} kindLabel={kindLabel} />
          ) : w != null ? (
            <Watts w={w} estimated={!!device.now?.estimated} />
          ) : undefined
        }
      />
      {device.rule && <RuleLine device={device} />}
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
        saving={saving}
      />
    </Card>
  );
}

/** What it's drawing, big, in the card's top corner. */
function Watts({ w, estimated }: { w: number; estimated: boolean }) {
  return (
    <span
      className="pt-1 text-[22px] leading-7 font-light tracking-[-0.5px] whitespace-nowrap tabular-nums"
      title={estimated ? ESTIMATED : undefined}
    >
      {watts(w, estimated)}
    </span>
  );
}

/**
 * A room (a group of devices) as one: what they're drawing together now, each of them with what it's doing and its
 * switch, then what they used together and their habits together. Its icon changes the room's colour and icon.
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
  givenColor,
  colors,
  look,
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
  /** The room's colour without one chosen (its first device's). */
  givenColor: string;
  /** Each device's own colour, for its icon in the list. */
  colors: Map<number, string>;
  /** The room's own look, if it has one. */
  look: RoomLook | undefined;
  home: number | null;
  rangeLabel: string;
  beforeLabel: string;
}) {
  const { roomLook } = useHomeChange();
  const { lit, off } = lights(members);
  const read = members.filter((d) => d.now && !d.now.stale && d.now.online && d.now.power_w != null);
  const power = read.reduce((a, d) => a + d.now!.power_w!, 0);
  const estimated = read.some((d) => d.now!.estimated);
  const running = members.filter((d) => d.now?.running && !d.now.stale);
  const lastRun = members
    .map((d) => d.last_run)
    .filter((r) => r != null)
    .sort((a, b) => b.start - a.start)[0];
  const count = members.length === 1 ? "1 device" : `${members.length} devices`;
  const status = running.length
    ? `${running.map((d) => d.name).join(" and ")} running`
    : off
      ? `${count}, offline`
      : lit
        ? `${count}, ${members.filter((d) => drawing(d) != null).length} on`
        : `${count}, idle`;
  return (
    <Card aria-label={name} className={CARD}>
      <Head
        look={
          <LookButton
            name={name}
            icon={hasIcon(look?.icon) ? look.icon : defaultRoomIcon(name, members)}
            color={color}
            lit={lit}
            off={off}
            look={{ color: look?.color ?? null, icon: look?.icon ?? null }}
            given={{ color: givenColor, icon: defaultRoomIcon(name, members) }}
            onPick={(change) => roomLook.mutate({ name, ...change })}
            pending={roomLook.isPending}
            error={roomLook.error}
          />
        }
        name={
          <Link to="/home/rooms/$room" params={{ room: name }} className="text-inherit no-underline hover:underline">
            {name}
          </Link>
        }
        status={status}
        tone={running.length ? "good" : "muted"}
        right={read.length > 0 && power >= 2 ? <Watts w={power} estimated={estimated} /> : undefined}
      />

      <ul className="m-0 flex list-none flex-col rounded-2xl bg-fg/3 p-1 light:bg-fg/4">
        {members.map((d) => {
          const now = nowLine(d);
          const mine = lights([d]);
          const c = colors.get(d.id) ?? color;
          return (
            <li key={d.id} className="flex min-h-11 items-center gap-3 rounded-xl px-2.5 py-1.5">
              <span
                className="flex size-7 flex-none items-center justify-center rounded-lg transition-colors duration-500"
                style={{
                  background: mine.off ? "transparent" : mine.lit ? alpha(c, 0.22) : alpha(c, 0.1),
                  color: mine.off ? "var(--color-ink-faint)" : c,
                }}
              >
                <Icon name={deviceIcon(d)} size={15} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">
                  <DeviceLink id={d.id}>{d.name}</DeviceLink>
                </span>
                <span
                  className={cn(
                    "truncate text-xs tabular-nums",
                    now.running ? "text-good" : mine.lit ? "text-ink-sub" : "text-ink-faint",
                  )}
                >
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
