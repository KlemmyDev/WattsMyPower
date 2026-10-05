import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { duration, hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { kW, kWh, money } from "~/features/common/formatting/utils/number";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { alpha } from "~/features/common/theme/utils/colors";
import { addDays, midnight } from "~/features/common/time/utils";
import { useNow } from "~/features/common/time/hooks";
import { Card } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { cn } from "~/features/common/ui/utils";
import { homeQuery, homeRunsQuery, homeUsageQuery, runCurveQuery } from "~/features/home/api";
import type { HomeRun } from "~/features/home/types";
import { deviceColors } from "~/features/home/utils";
import { BackLink } from "~/features/settings/components/SubPageHeader";

const WEEKS = 8;

/** Monday 00:00 of the week `ts` is in. */
function weekStart(ts: number) {
  const day = midnight(ts);
  return addDays(day, -((new Date(day * 1000).getDay() + 6) % 7));
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
  if (!data?.w.length) return <span className="text-xs text-ink-muted">Nothing was read through this run.</span>;
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
        <span>Peak {kW(top)}</span>
        <span>{hhmm(data.t[n - 1] + 300)}</span>
      </div>
    </div>
  );
}

/**
 * One device on its own: what it used week by week (this week so far against the ones before) and day by day, and
 * for an appliance that runs in cycles, each run with what it drew through it.
 */
export function DevicePage({ id }: { id: number }) {
  const now = useNow(60_000);
  const today = midnight(now);
  const first = addDays(weekStart(now), -7 * (WEEKS - 1));
  const overview = useQuery(homeQuery);
  const usage = useQuery(homeUsageQuery(first, addDays(today, 1), "day"));
  const runs = useQuery(homeRunsQuery(first, addDays(today, 1), id));
  const [open, setOpen] = useState<number | null>(null);
  const devices = overview.data?.devices ?? [];
  const device = devices.find((d) => d.id === id);
  const color = deviceColors(devices).get(id) ?? "var(--color-brand)";
  const kind = overview.data?.kinds.find((k) => k.id === device?.kind);
  const used = usage.data?.devices.find((d) => d.id === id);

  const weeks = Array.from({ length: WEEKS }, (_, i) => addDays(first, 7 * i));
  const byWeek = weeks.map(() => 0);
  const byDay: { t: number; kwh: number }[] = [];
  usage.data?.t.forEach((t, i) => {
    const kwh = used?.kwh[i] ?? 0;
    byWeek[Math.min(WEEKS - 1, Math.floor((t - first) / (7 * 86400)))] += kwh;
    if (t >= addDays(today, -29)) byDay.push({ t, kwh });
  });
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

  return (
    <>
      <div className="pt-2">
        <BackLink to="/home">Home</BackLink>
      </div>
      <PageHeader
        title={device?.name ?? (overview.data ? "No such device" : "…")}
        sub={[kind?.label, device?.model, device?.group && `In ${device.group}`].filter(Boolean).join(" · ") || " "}
      />
      {overview.data && !device && <Notice>There's no such device. It may have been disconnected.</Notice>}
      <div className="grid grid-cols-12 gap-5">
        <Card aria-labelledby="h-weeks" className="col-span-6 gap-4 max-lg:col-span-12">
          <div className="flex flex-col gap-0.5">
            <h2 id="h-weeks">Week by week</h2>
            <span className="text-[13px] text-ink-muted">
              {change == null
                ? `What it used each week, Monday to Sunday, over the last ${WEEKS}`
                : `This week so far: ${kWh(thisWeek)}, ${
                    Math.abs(change) < 0.05
                      ? "about the same as"
                      : `${Math.round(Math.abs(change) * 100)}% ${change > 0 ? "more than" : "less than"}`
                  } the same days last week`}
            </span>
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
        <Card aria-labelledby="h-days" className="col-span-6 gap-4 max-lg:col-span-12">
          <div className="flex flex-col gap-0.5">
            <h2 id="h-days">Day by day</h2>
            <span className="text-[13px] text-ink-muted">The last 30 days, today on the right</span>
          </div>
          {usage.data ? (
            <Bars
              values={byDay.map((d) => d.kwh)}
              labels={byDay.map((d, i) =>
                i % 5 === 4 || i === byDay.length - 1 ? String(new Date(d.t * 1000).getDate()) : "",
              )}
              color={color}
              title="What it used each day"
            />
          ) : (
            <Skeleton className="h-[160px]" />
          )}
        </Card>
        {(kind?.cycles || !!runs.data?.length) && (
          <Card aria-labelledby="h-runs" className="col-span-12 gap-2">
            <div className="flex flex-col gap-0.5 pb-2">
              <h2 id="h-runs">Runs</h2>
              <span className="text-[13px] text-ink-muted">
                Every run in the last {WEEKS} weeks, newest first. Open one to see what it drew through it.
              </span>
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
                  <span className="w-[80px] text-ink-muted">{r.end ? duration(r.end - r.start) : "Running"}</span>
                  <span className="w-[80px]">{r.kwh > 0 ? kWh(r.kwh) : "—"}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-muted">{r.program ?? ""}</span>
                  {r.peak_w != null && <span className="text-ink-muted">Peak {kW(r.peak_w)}</span>}
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
      </div>
    </>
  );
}
