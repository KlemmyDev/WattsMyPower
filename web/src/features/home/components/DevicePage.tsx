import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { duration, hhmm, hourLabel, shortDay } from "~/features/common/formatting/utils/date";
import { DASH, kW, kWh, money } from "~/features/common/formatting/utils/number";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { alpha } from "~/features/common/theme/utils/colors";
import { useNow } from "~/features/common/time/hooks";
import { addDays, midnight, mondayFirst, partsOf } from "~/features/common/time/utils";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { cn } from "~/features/common/ui/utils";
import {
  homeInsightsQuery,
  homePatternsQuery,
  homeProfileQuery,
  homeQuery,
  homeRunsQuery,
  homeUsageQuery,
  runCurveQuery,
} from "~/features/home/api";
import { AboutCard, AheadCard, Corner, SpikesCard, WeekCard } from "~/features/home/components/Analysis";
import { Power } from "~/features/home/components/DeviceCard";
import { ItemHero, itemStats, type ItemLive } from "~/features/home/components/ItemHero";
import { LookButton } from "~/features/home/components/LookPicker";
import { RuleCard } from "~/features/home/components/RuleCard";
import { useHomeChange } from "~/features/home/hooks";
import type { HomeDevice, HomeRun } from "~/features/home/types";
import {
  defaultDeviceIcon,
  deviceColors,
  deviceIcon,
  drawing,
  givenDeviceColor,
  habitLine,
  nowLine,
} from "~/features/home/utils";
import { BackLink } from "~/features/settings/components/SubPageHeader";

const WEEKS = 8;

/** Monday 00:00 of the week `ts` is in. */
function weekStart(ts: number) {
  const day = midnight(ts);
  return addDays(day, -mondayFirst(day));
}

/** Bars, oldest first, the last one (the one still going) drawn in full colour, with a label under each. */
function Bars({ values, labels, color, title }: { values: number[]; labels: string[]; color: string; title: string }) {
  const top = Math.max(...values, 0.001);
  return (
    <div className="flex flex-col gap-1" role="img" aria-label={title}>
      <div className="flex h-[140px] items-end gap-1.5">
        {values.map((v, i) => (
          <div key={i} title={kWh(v)} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            {values.length <= 12 && (
              <span className="font-mono text-[10px] whitespace-nowrap text-ink-faint tabular-nums">
                {v >= 0.05 ? kWh(v) : ""}
              </span>
            )}
            <span
              className="w-full rounded-t-[4px]"
              style={{
                height: `${Math.max(v > 0 ? 3 : 0, (v / top) * 100)}%`,
                background: i === values.length - 1 ? color : alpha(color, 0.45),
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5">
        {labels.map((l, i) => (
          <span
            key={i}
            className="min-w-0 flex-1 overflow-visible text-center font-mono text-[10px] whitespace-nowrap text-ink-faint"
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

/** What the appliance drew through a run, as an area: W every 5 minutes, from a little before it to a little after. */
function Curve({ run, color }: { run: HomeRun; color: string }) {
  const { data, isPending } = useQuery(runCurveQuery(run.id));
  if (isPending) return <Skeleton className="h-[90px]" />;
  if (!data?.w.length) return <span className="text-xs text-ink-muted">No readings for this run.</span>;
  const top = Math.max(...data.w, 1);
  const n = data.w.length;
  const x = (i: number) => (i / Math.max(1, n - 1)) * 100;
  const y = (w: number) => 100 - (w / top) * 92;
  const line = data.w.map((w, i) => `${x(i)},${y(w)}`).join(" ");
  return (
    <div className="flex flex-col gap-1">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-[90px] w-full" aria-hidden>
        <polygon points={`0,100 ${line} 100,100`} fill={alpha(color, 0.18)} />
        <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between font-mono text-[10px] text-ink-faint">
        <span>{hhmm(data.t[0])}</span>
        <span>Highest draw {kW(top)}</span>
        <span>{hhmm(data.t[n - 1] + 300)}</span>
      </div>
    </div>
  );
}

/** What a device is doing now, for its top card's live figure: running (its phase and time left), on, or why not. */
function liveOf(d: HomeDevice | undefined, kindLabel: string): ItemLive {
  if (!d) return { w: null, estimated: false, running: false, quiet: DASH, status: null };
  const n = d.now;
  const w = drawing(d);
  const running = !!n && !n.stale && n.running;
  const quiet = !n ? "No reading" : n.stale || !n.online ? "Offline" : n.switched_on === false ? "Off" : "Idle";
  const left = running && n.remaining_min ? `${Math.round(n.remaining_min)} min left` : null;
  const status = running
    ? [n.phase ?? "Running", n.program !== n.phase && n.program, left].filter(Boolean).join(" · ")
    : !n || n.stale
      ? nowLine(d).text
      : !n.online
        ? "Can't be reached"
        : w != null
          ? n.estimated
            ? "Estimated from its runs"
            : "On"
          : d.last_run
            ? `Last ran ${shortDay.format(new Date(d.last_run.start * 1000))}`
            : null;
  return {
    w,
    estimated: !!n?.estimated,
    running,
    quiet,
    status: status && <span>{status}</span>,
    control: <Power device={d} kindLabel={kindLabel} align="start" />,
  };
}

/**
 * One device on its own: its top card in its own colour (used today against its usual day, what it's drawing now with
 * its switch, what it's cost, its runs, what's always on and when best to run it, with its day), its spare-solar rule,
 * what it used week by week and day by day, each run with what it drew through it, when in the week it uses power,
 * what's likely ahead, its spikes, and what it says about itself.
 */
export function DevicePage({ id }: { id: number }) {
  const now = useNow(60_000);
  const today = midnight(now);
  const first = addDays(weekStart(now), -7 * (WEEKS - 1));
  const overview = useQuery(homeQuery);
  const usage = useQuery(homeUsageQuery(first, addDays(today, 1), "day"));
  const todays = useQuery(homeUsageQuery(today, addDays(today, 1), "hour"));
  const runs = useQuery(homeRunsQuery(first, addDays(today, 1), id));
  const profile = useQuery(homeProfileQuery([id]));
  const patterns = useQuery(homePatternsQuery);
  const found = useQuery(homeInsightsQuery);
  const { deviceLook } = useHomeChange();
  const [open, setOpen] = useState<number | null>(null);
  const devices = overview.data?.devices ?? [];
  const rooms = overview.data?.rooms ?? [];
  const device = devices.find((d) => d.id === id);
  const color = deviceColors(devices, rooms).get(id) ?? "var(--color-brand)";
  const kind = overview.data?.kinds.find((k) => k.id === device?.kind);
  const kindLabel = kind?.label ?? "Device";
  const used = usage.data?.devices.find((d) => d.id === id);
  const rate = used && used.total > 0.1 ? used.cost / used.total : null;
  const pattern = patterns.data?.find((x) => x.id === id);
  const saving = found.data?.savings.find((x) => x.id === id);
  const live = liveOf(device, kindLabel);

  const weeks = Array.from({ length: WEEKS }, (_, i) => addDays(first, 7 * i));
  const byWeek = weeks.map(() => 0);
  const byDay: { t: number; kwh: number }[] = [];
  usage.data?.t.forEach((t, i) => {
    const kwh = used?.kwh[i] ?? 0;
    byWeek[Math.min(WEEKS - 1, Math.floor((t - first) / (7 * 86400)))] += kwh;
    if (t >= addDays(today, -29)) byDay.push({ t, kwh });
  });
  const month = byDay.reduce((a, d) => a + d.kwh, 0);
  // This week so far against the same days of last week.
  const sinceMonday = Math.round((today - weekStart(now)) / 86400) + 1;
  const lastWeekSoFar =
    usage.data?.t.reduce(
      (a, t, i) =>
        t >= addDays(weekStart(now), -7) && t < addDays(weekStart(now), -7 + sinceMonday) ? a + (used?.kwh[i] ?? 0) : a,
      0,
    ) ?? 0;
  const thisWeek = byWeek[WEEKS - 1];
  const change = lastWeekSoFar > 0.05 ? (thisWeek - lastWeekSoFar) / lastWeekSoFar : null;
  const habit = habitLine(pattern, !!kind?.cycles);

  return (
    <>
      <div className="pt-2">
        {/* Back to its room, when it's in one. */}
        {device?.group ? (
          <BackLink to="/home/rooms/$room" params={{ room: device.group }}>
            {device.group}
          </BackLink>
        ) : (
          <BackLink to="/home">Home</BackLink>
        )}
      </div>
      <PageHeader
        title={
          device ? (
            <span className="flex items-center gap-3">
              <LookButton
                name={device.name}
                icon={deviceIcon(device)}
                color={color}
                lit={live.running || live.w != null}
                off={!device.now || !!device.now.stale || !device.now.online}
                look={{ color: device.color ?? null, icon: device.icon ?? null }}
                given={{ color: givenDeviceColor(devices, rooms, device.id), icon: defaultDeviceIcon(device) }}
                onPick={(change) => deviceLook.mutate({ id: device.id, ...change })}
                pending={deviceLook.isPending}
                error={deviceLook.error}
                size={40}
              />
              <span className="min-w-0">{device.name}</span>
            </span>
          ) : overview.data ? (
            "No such device"
          ) : (
            "…"
          )
        }
        sub={
          [device && kindLabel, device?.model, device?.group && `In ${device.group}`].filter(Boolean).join(" · ") || " "
        }
        action={
          device?.integration && (
            <ButtonLink
              to="/integrations/home/$integration/$device"
              params={{ integration: device.integration, device: String(device.id) }}
              variant="outline"
              size="sm"
            >
              Settings
            </ButtonLink>
          )
        }
      />
      {overview.data && !device && <Notice>Can't find this device. It may have been disconnected.</Notice>}
      {device && (
        <div className="flex flex-col gap-5">
          <ItemHero
            name={device.name}
            color={color}
            profile={profile.data}
            now={now}
            live={live}
            stats={itemStats({
              members: [device],
              today: todays.data,
              profile: profile.data,
              patterns: patterns.data,
              found: found.data,
              kinds: new Map((overview.data?.kinds ?? []).map((k) => [k.id, k])),
              now,
            })}
          />
          <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1">
            <div className="flex min-w-0 flex-col gap-5 max-3xl:contents">
              <Card aria-labelledby="h-weeks" className="gap-4">
                <div className="flex items-end justify-between gap-4">
                  <TitleBlock
                    id="h-weeks"
                    className="min-w-0 flex-1"
                    title="Week by week"
                    sub={`Monday to Sunday, the last ${WEEKS} weeks`}
                  />
                  {usage.data && (
                    <Corner
                      label="This week"
                      sub={
                        change == null
                          ? undefined
                          : Math.abs(change) < 0.05
                            ? "As last week by now"
                            : `${Math.round(Math.abs(change) * 100)}% ${change > 0 ? "more" : "less"} than last week by now`
                      }
                    >
                      {kWh(thisWeek)}
                    </Corner>
                  )}
                </div>
                {usage.data ? (
                  <Bars
                    values={byWeek}
                    labels={weeks.map((w) => shortDay.format(new Date(w * 1000)).replace(/^\w+,?\s*/, ""))}
                    color={color}
                    title="What it used each week"
                  />
                ) : (
                  <Skeleton className="h-[160px]" />
                )}
                {used && (
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink-muted tabular-nums">
                    <span>
                      <b className="font-medium text-ink">{kWh(used.total)}</b> in {WEEKS} weeks
                    </span>
                    <span>
                      <b className="font-medium text-ink">{money(used.cost)}</b> from the grid
                    </span>
                    {used.solar_share != null && (
                      <span>
                        <b className="font-medium text-ink">{Math.round(used.solar_share * 100)}%</b> from solar or the
                        battery
                      </span>
                    )}
                  </div>
                )}
              </Card>
              <Card aria-labelledby="h-days" className="gap-4">
                <div className="flex items-end justify-between gap-4">
                  <TitleBlock
                    id="h-days"
                    className="min-w-0 flex-1"
                    title="Day by day"
                    sub="The last 30 days, today on the right"
                  />
                  {usage.data && byDay.length > 0 && (
                    <Corner label="Last 30 days" sub={`About ${kWh(month / byDay.length)} a day`}>
                      {kWh(month)}
                    </Corner>
                  )}
                </div>
                {usage.data ? (
                  <Bars
                    values={byDay.map((d) => d.kwh)}
                    labels={byDay.map((d, i) =>
                      i % 5 === 4 || i === byDay.length - 1 ? String(partsOf(d.t).day) : "",
                    )}
                    color={color}
                    title="What it used each day"
                  />
                ) : (
                  <Skeleton className="h-[160px]" />
                )}
              </Card>
              {(kind?.cycles || !!runs.data?.length) && (
                <Card aria-labelledby="h-runs" className="gap-2">
                  <div className="flex flex-col gap-0.5 pb-2">
                    <h2 id="h-runs">Runs</h2>
                    <span className="text-[13px] text-pretty text-ink-muted">
                      {habit ?? `Every run in the last ${WEEKS} weeks, newest first`}. Open one to see what it drew.
                    </span>
                    {saving && saving.saved >= 0.5 && (
                      <span className="text-[13px] text-pretty text-ink-muted">
                        Running around {hourLabel(saving.best_hour)} instead of {hourLabel(saving.usual_hour)} would
                        have saved <b className="font-medium text-ink">{money(saving.saved)}</b> on its last{" "}
                        {saving.runs} runs.
                      </span>
                    )}
                  </div>
                  {runs.data && !runs.data.length && <span className="text-sm text-ink-muted">No runs yet.</span>}
                  {runs.data?.map((r) => (
                    <div key={r.id} className="border-t border-line-subtle first:border-t-0">
                      <button
                        type="button"
                        aria-expanded={open === r.id}
                        onClick={() => setOpen(open === r.id ? null : r.id)}
                        className="flex w-full cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 border-0 bg-transparent px-0 py-3 text-left font-sans text-sm text-ink tabular-nums"
                      >
                        <Icon
                          name="chevR"
                          size={14}
                          className={cn("flex-none text-ink-muted transition-transform", open === r.id && "rotate-90")}
                        />
                        <span className="w-[150px] font-medium">
                          {shortDay.format(new Date(r.start * 1000))}, {hhmm(r.start)}
                        </span>
                        <span className="w-[72px] text-ink-muted">{r.end ? duration(r.end - r.start) : "Running"}</span>
                        <span className="w-[72px]">{r.kwh > 0 ? kWh(r.kwh) : DASH}</span>
                        <span className="min-w-0 flex-1 truncate text-ink-muted">{r.program ?? ""}</span>
                        {r.peak_w != null && <span className="text-ink-muted">Highest draw {kW(r.peak_w)}</span>}
                      </button>
                      {open === r.id && (
                        <div className="pb-4 pl-[30px]">
                          <Curve run={r} color={color} />
                        </div>
                      )}
                    </div>
                  ))}
                </Card>
              )}
              {profile.data ? (
                <WeekCard profile={profile.data} color={color} />
              ) : (
                <Skeleton className="h-[260px] rounded-3xl" />
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-5 max-3xl:contents">
              <RuleCard key={device.id} device={device} className="max-3xl:-order-1" />
              {profile.data ? (
                <>
                  <AheadCard profile={profile.data} color={color} rate={rate} />
                  <SpikesCard profile={profile.data} devices={[device]} colors={new Map([[id, color]])} />
                </>
              ) : (
                <Skeleton className="h-[300px] rounded-3xl" />
              )}
              <AboutCard device={device} kindLabel={kindLabel} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
