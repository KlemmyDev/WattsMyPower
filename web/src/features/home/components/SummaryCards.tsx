import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { billsQuery } from "~/features/bills/api";
import { errorMessage } from "~/features/common/api/utils";
import { shortDay } from "~/features/common/formatting/utils/date";
import { dollars, kWh, money } from "~/features/common/formatting/utils/number";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { useSaveSettings } from "~/features/common/settings/hooks";
import { Button } from "~/features/common/ui/components/Button";
import { Card } from "~/features/common/ui/components/Card";
import { HelpText, Input } from "~/features/common/ui/components/Field";
import { Swatch } from "~/features/common/ui/components/Swatch";
import { cn } from "~/features/common/ui/utils";
import type { Change, HomeInsights, HomeUsage } from "~/features/home/types";
import { type HomeItem } from "~/features/home/utils";

/** How far along, as a bar: green on track, red not. */
function Meter({ value, bad, label }: { value: number; bad: boolean; label: string }) {
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      className="h-2 overflow-hidden rounded-full bg-surface-raised"
    >
      <div
        className={cn("h-full rounded-full", bad ? "bg-bad" : "bg-good")}
        style={{ width: `${Math.max(2, Math.min(1, value) * 100)}%` }}
      />
    </div>
  );
}

const pct = (now: number, before: number) => Math.round((Math.abs(now - before) / before) * 100);
const more = (now: number, before: number) => (now > before ? "more" : "less");

/** A change in a sentence, with a link to the device (or the room's first device) where there's one. */
function ChangeLine({ c }: { c: Change }) {
  const link = (id: number, name: string) => (
    <Link
      to="/home/$device"
      params={{ device: String(id) }}
      className="font-medium text-ink no-underline hover:underline"
    >
      {name}
    </Link>
  );
  switch (c.type) {
    case "use":
      return (
        <>
          {link(c.id, c.name)} used {pct(c.now, c.before)}% {more(c.now, c.before)} than the week before ({kWh(c.now)},
          against {kWh(c.before)}).
        </>
      );
    case "new":
      return (
        <>
          {link(c.id, c.name)} used {kWh(c.now)}, the first week it's used anything.
        </>
      );
    case "runs":
      return (
        <>
          {link(c.id, c.name)} ran {c.now} {c.now === 1 ? "time" : "times"}, {Math.abs(c.now - c.before)}{" "}
          {c.now > c.before ? "more" : "fewer"} than the week before.
        </>
      );
    case "car":
      return (
        <>
          The car charged {kWh(c.now)}, against {kWh(c.before)} the week before.
        </>
      );
    case "standby":
      return (
        <>
          What's always on is {c.now < c.before ? "down" : "up"} {Math.abs(c.now - c.before)} W, to {c.now} W.
        </>
      );
    case "quiet":
      return (
        <>
          {link(c.id, c.name)} hasn't used anything since {shortDay.format(new Date(c.since * 1000))}. Is it unplugged
          or offline?
        </>
      );
  }
}

/** What changed in the last week, in a few lines: devices and rooms using more or less, runs, the car, standby. */
export function ChangesCard({ changes }: { changes: HomeInsights["changes"] | undefined }) {
  if (!changes?.items.length) return null;
  return (
    <Card aria-labelledby="h-changes" className="col-span-12 gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id="h-changes">This week</h2>
        <span className="text-[13px] text-ink-muted">What's changed in the last 7 days, against the 7 before</span>
      </div>
      <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-sm text-pretty text-ink-muted marker:text-ink-faint">
        {changes.items.map((c, i) => (
          <li key={i}>
            <ChangeLine c={c} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * The current bill against its budget (Bills → Rates & settings: the same budget, set here or there), and what's always on
 * against a target. Each can be set here.
 */
export function GoalsCard({ standbyW }: { standbyW: number | null | undefined }) {
  const s = useSystem();
  const bills = useQuery(billsQuery);
  const save = useSaveSettings();
  const [editing, setEditing] = useState(false);
  const [budget, setBudget] = useState("");
  const [goal, setGoal] = useState("");
  const b = bills.data;
  const soFar = b?.current.so_far.net_cost;
  const expected = b?.current.expected?.net_cost ?? null;
  const target = s?.bill_budget || null;
  const standbyGoal = s?.home_standby_goal || null;
  const open = () => {
    setBudget(target ? String(target) : "");
    setGoal(standbyGoal ? String(standbyGoal) : "");
    setEditing(true);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const num = (v: string) => (v.trim() === "" ? 0 : Number(v));
    save.mutate({ bill_budget: num(budget), home_standby_goal: num(goal) }, { onSuccess: () => setEditing(false) });
  };
  return (
    <Card aria-labelledby="h-goals" className="col-span-12 gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="h-goals">Goals</h2>
          <span className="text-[13px] text-ink-muted">This bill against its budget, and what's always on</span>
        </div>
        {!editing && (
          <Button variant="outline" size="sm" onClick={open}>
            {target || standbyGoal ? "Change" : "Set goals"}
          </Button>
        )}
      </div>
      {editing ? (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
            Budget a bill
            <Input
              prefix="$"
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              boxClassName="w-[160px]"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
            Always on, at most
            <Input
              unit="W"
              inputMode="numeric"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              boxClassName="w-[160px]"
            />
          </label>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="muted-link" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <HelpText className="basis-full">Leave one blank for none. The budget is the one on the Bills page.</HelpText>
          {save.isError && <HelpText tone="bad">{errorMessage(save.error)}</HelpText>}
        </form>
      ) : (
        <div className="grid grid-cols-2 gap-6 max-md:grid-cols-1">
          <div className="flex flex-col gap-2">
            <span className="text-[13px] text-ink-muted">This bill{b ? `, day ${b.period.day}` : ""}</span>
            {soFar == null ? (
              <span className="text-sm text-ink-muted">…</span>
            ) : (
              <>
                <span className="text-sm tabular-nums">
                  <b className="text-[22px] font-light">{money(soFar)}</b> so far
                  {expected != null && <>, about {dollars(expected)} by the end</>}
                  {target && <> of a {dollars(target)} budget</>}
                </span>
                {target && expected != null && (
                  <>
                    <Meter value={soFar / target} bad={expected > target} label="This bill so far, of its budget" />
                    <span className={cn("text-[13px]", expected > target ? "text-bad" : "text-good")}>
                      {expected > target
                        ? `On course to go ${dollars(expected - target)} over`
                        : `On track: about ${dollars(target - expected)} to spare`}
                    </span>
                  </>
                )}
                {!target && <span className="text-[13px] text-ink-muted">Set a budget to see if you're on track.</span>}
              </>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[13px] text-ink-muted">Always on</span>
            {standbyW == null ? (
              <span className="text-sm text-ink-muted">This shows after a few nights of readings.</span>
            ) : (
              <>
                <span className="text-sm tabular-nums">
                  <b className="text-[22px] font-light">{Math.round(standbyW)} W</b>
                  {standbyGoal && <> against a target of {standbyGoal} W</>}
                </span>
                {standbyGoal && (
                  <>
                    <Meter
                      value={standbyGoal / Math.max(standbyW, 1)}
                      bad={standbyW > standbyGoal * 1.5}
                      label="The always-on target, against what's always on"
                    />
                    <span className={cn("text-[13px]", standbyW > standbyGoal ? "text-ink-muted" : "text-good")}>
                      {standbyW > standbyGoal ? `${Math.round(standbyW - standbyGoal)} W to go` : "Target met"}
                    </span>
                  </>
                )}
                {!standbyGoal && (
                  <span className="text-[13px] text-ink-muted">Set a target to track it coming down.</span>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * Each room (a group of devices) at a glance: what it used and cost in the period shown, its share of the home's use,
 * and against the period before.
 */
export function RoomsCard({
  items,
  usage,
  before,
  colors,
  rangeLabel,
}: {
  items: HomeItem[];
  usage: HomeUsage | undefined;
  /** What each room used in the period before (by its id); undefined: not compared. */
  before: (id: number) => number | undefined;
  colors: Map<number, string>;
  rangeLabel: string;
}) {
  const rooms = items.filter((i) => i.group);
  if (!rooms.length || !usage) return null;
  const home = usage.total.home;
  return (
    <Card aria-labelledby="h-rooms" className="col-span-12 gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id="h-rooms">Rooms</h2>
        <span className="text-[13px] text-ink-muted">What each room used and cost {rangeLabel}</span>
      </div>
      <div className="flex flex-col">
        {rooms.map((r) => {
          const u = usage.devices.find((d) => d.id === r.id);
          const was = before(r.id);
          const change = u && was != null && was > 0.05 ? (u.total - was) / was : null;
          return (
            <div
              key={r.group}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-subtle py-2.5 text-sm tabular-nums first:border-t-0"
            >
              <Swatch color={colors.get(r.id) ?? "var(--color-bar)"} size={10} />
              <Link
                to="/home/rooms/$room"
                params={{ room: r.group! }}
                className="min-w-[120px] flex-1 font-medium text-ink no-underline hover:underline"
              >
                {r.group}
              </Link>
              <span className="w-20 text-right">{kWh(u?.total ?? 0)}</span>
              <span className="w-16 text-right text-ink-muted">{money(u?.cost ?? 0)}</span>
              <span className="w-12 text-right text-ink-faint">
                {home && u ? `${Math.round((u.total / home) * 100)}%` : ""}
              </span>
              <span className={cn("w-24 text-right text-xs", change != null && change > 0 ? "text-ink" : "text-good")}>
                {change == null
                  ? ""
                  : Math.abs(change) < 0.05
                    ? "about the same"
                    : `${change > 0 ? "↑" : "↓"} ${Math.round(Math.abs(change) * 100)}%`}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
