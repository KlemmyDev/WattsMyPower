import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { suggestQuery } from "~/features/car/api";
import { useChargeChange } from "~/features/car/hooks";
import type { CarView, ChargeMode, SuggestedCharge, SuggestRequest, Suggestions } from "~/features/car/types";
import {
  costWords,
  fromLocal,
  MODE,
  MODES,
  nextReadyBy,
  phaseWord,
  solarWords,
  toLocal,
  when,
} from "~/features/car/utils";
import { errorMessage } from "~/features/common/api/utils";
import { duration, hhmm } from "~/features/common/formatting/utils/date";
import { intAU, kWh, kWhInt, money, pct } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Button } from "~/features/common/ui/components/Button";
import { Muted } from "~/features/common/ui/components/Card";
import { Field, HelpText, Input, Select } from "~/features/common/ui/components/Field";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { useToast } from "~/features/common/ui/components/Toast";
import { addDays, midnight } from "~/features/common/time/utils";
import { cn } from "~/features/common/ui/utils";

type Plannable = Omit<SuggestedCharge, "kind">;

/** Plan a suggested charge, steps and all, then say so. */
function usePlanSuggestion(car: number, s: Suggestions | undefined) {
  const { addPlan } = useChargeChange();
  const toast = useToast();
  const plan = (c: Plannable, now: number) =>
    addPlan.mutate(
      {
        car,
        steps: c.steps.map(({ start, end, amps }) => ({ start, end, amps })),
        phases: c.phases,
        soc_now: c.soc_from,
        battery_helps: c.battery_helps,
        // Starting from where an earlier planned charge leaves it isn't the car's level now.
        level_now: s?.planned_soc == null,
      },
      { onSuccess: () => toast(`Charge planned for ${when(c.start, now)}. Set it in the car's app.`) },
    );
  return { plan, pending: addPlan.isPending, error: addPlan.isError ? errorMessage(addPlan.error) : "" };
}

/** A time it could be needed by, for the "Needed by" list. */
type ReadyOption = { value: string; label: string; ts: number };

const QUARTER = 900;

/**
 * The times to offer for "Needed by", soonest first: in an hour or a few (to the next quarter hour), the car's usual
 * time and the one after (from its details), and tomorrow morning and evening. A time offered twice keeps its first
 * name; one less than 15 minutes away (the least the planner takes) isn't offered.
 */
export function readyOptions(now: number, minutes: number, days: CarView["car"]["car_days"]): ReadyOption[] {
  const soon = (h: number) => Math.ceil((now + h * 3600) / QUARTER) * QUARTER;
  const tomorrow = addDays(midnight(now), 1);
  const next = nextReadyBy(now, minutes, days);
  const after = nextReadyBy(now, minutes, days, 1);
  const all: ReadyOption[] = [
    { value: "next", label: `${when(next, now)} (usual)`, ts: next },
    { value: "after", label: `${when(after, now)} (the one after)`, ts: after },
    ...[1, 2, 4, 8].map((h) => ({
      value: `in${h}`,
      label: `In ${h} ${h === 1 ? "hour" : "hours"} (${hhmm(soon(h))})`,
      ts: soon(h),
    })),
    { value: "morning", label: `Tomorrow morning (${hhmm(tomorrow + 7 * 3600)})`, ts: tomorrow + 7 * 3600 },
    { value: "evening", label: `Tomorrow evening (${hhmm(tomorrow + 17 * 3600)})`, ts: tomorrow + 17 * 3600 },
  ];
  const seen = new Set<number>();
  return all.filter((o) => o.ts - now >= QUARTER && !seen.has(o.ts) && seen.add(o.ts)).sort((a, b) => a.ts - b.ts);
}

/**
 * Suggested charges for a connected car: from its charge now to the level to charge it to (both from the slider
 * above) by a time. A plan for each aim (cheapest, most solar, sparing the home battery, fastest), the chosen one in
 * full with its steps drawn against the spare solar, and all four side by side, folded away.
 */
export function SuggestedCharges({
  view,
  now,
  socNow,
  socTo,
}: {
  view: CarView;
  now: number;
  socNow: number | null;
  socTo: number;
}) {
  const c = view.car;
  const [ready, setReady] = useState("next");
  const [mode, setMode] = useState<ChargeMode>(c.car_charge_mode);
  const options = readyOptions(now, c.car_ready_by, c.car_days);
  const [other, setOther] = useState(() => toLocal(nextReadyBy(now, c.car_ready_by, c.car_days, 1) + 10.5 * 3600));
  // A relative choice keeps its time as the clock moves on; one that has gone by falls back to the usual time.
  const picked = options.find((o) => o.value === ready) ?? options.find((o) => o.value === "next") ?? options[0];

  const req: SuggestRequest = {
    soc_now: socNow ?? undefined,
    soc_to: socTo,
    ready_by: ready === "other" ? (other ? fromLocal(other) : undefined) : picked?.ts,
  };
  // Suggestions follow the form, a moment after the slider or the time stops moving. Every aim's plan comes back at once, so choosing
  // another aim needs no new request.
  const key = JSON.stringify(req);
  const [asked, setAsked] = useState(req);
  useEffect(() => {
    const t = setTimeout(() => setAsked(JSON.parse(key)), 300);
    return () => clearTimeout(t);
  }, [key]);
  const can = asked.soc_now != null && asked.soc_to != null && asked.ready_by != null;
  const q = useQuery({ ...suggestQuery(view.id, asked), enabled: can, placeholderData: keepPreviousData });
  const s = q.data;
  const { plan, pending, error } = usePlanSuggestion(view.id, s);
  const chosen = s?.options.find((o) => o.kind === mode) ?? s?.options[0];

  return (
    <div className="flex flex-col gap-5 rounded-2xl bg-surface-inset p-5 max-sm:p-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[15px] font-semibold">Best times to charge</h3>
        <Muted>
          From the solar forecast, your home use and your rates. Set the times and current in the car's app.
        </Muted>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] items-start gap-4">
        <Field label={`Charged to ${socTo}% by`}>
          <Select
            value={ready === "other" ? "other" : (picked?.value ?? "other")}
            onChange={(e) => setReady(e.target.value)}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            <option value="other">Another time…</option>
          </Select>
        </Field>
        {ready === "other" && (
          <Field label="At" help="Up to a week ahead.">
            <Input type="datetime-local" value={other} onChange={(e) => setOther(e.target.value)} />
          </Field>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold">Aim for</span>
        <Segmented
          label="Aim for"
          className="self-start max-sm:self-stretch max-sm:overflow-x-auto"
          options={MODES.map((m) => ({ value: m, label: MODE[m].label }))}
          value={mode}
          onChange={setMode}
        />
        <span className="text-xs text-ink-muted">
          {MODE[mode].about}
          {mode === c.car_charge_mode ? "" : " Your usual aim is set in the car's details."}
        </span>
      </div>
      {!can ? (
        <Muted>Set the car's charge on the slider above to see the best times to charge it.</Muted>
      ) : q.isError ? (
        <HelpText tone="bad">{errorMessage(q.error)}</HelpText>
      ) : !s ? (
        <Skeleton className="h-[220px]" />
      ) : (
        <div className="flex flex-col gap-5" aria-busy={q.isFetching}>
          <Summary s={s} now={now} />
          {chosen && (
            <Chosen c={chosen} s={s} asked={mode} now={now} onPlan={() => plan(chosen, now)} pending={pending} />
          )}
          {s.reachable && s.options.length > 1 && (
            <details className="group flex flex-col">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-semibold text-ink-muted hover:text-ink [&::-webkit-details-marker]:hidden">
                <Icon name="chevR" size={14} className="transition-transform group-open:rotate-90" />
                Compare the four aims
              </summary>
              <Compare options={s.options} chosen={chosen?.kind} onChoose={setMode} now={now} />
            </details>
          )}
          {s.single_phase && (
            <SinglePhase
              s={s}
              minKw={(c.car_min_amps * c.car_voltage * 3) / 1000}
              now={now}
              onPlan={plan}
              pending={pending}
            />
          )}
          <HelpText tone="bad" role="alert">
            {error}
          </HelpText>
        </div>
      )}
    </div>
  );
}

/** What the car needs and what's there to give it, before the plans. */
function Summary({ s, now }: { s: Suggestions; now: number }) {
  const by = when(s.ready_by, now);
  if (s.covered)
    return (
      <Notice tone="info">
        The charges already planned take it to {pct(s.planned_soc ?? s.soc_to)} by {by}. Nothing more is needed.
      </Notice>
    );
  if (s.soc_now >= s.soc_to) return <Muted>It's already at {pct(s.soc_now)}: nothing to charge.</Muted>;
  if (!s.reachable)
    return (
      <Notice tone="warn">
        It can't reach {pct(s.soc_to)} by {by}.{" "}
        {s.options[0]
          ? `Charging at full speed from now gets it to about ${pct(s.options[0].soc_to)}.`
          : "There's no time left to charge before then."}
      </Notice>
    );
  return (
    <Muted className="tabular-nums">
      {s.planned_soc != null && `The charges already planned take it to ${pct(s.planned_soc)}. `}
      To reach {pct(s.soc_to)} by {by}, it needs about {kWh(s.wall_kwh)} from the wall (adds about {intAU(s.km)} km).
      {s.spare_kwh != null &&
        (s.spare_kwh >= 1
          ? ` About ${kWhInt(s.spare_kwh)} of solar is forecast to go spare before then.`
          : " Little spare solar is forecast before then.")}
    </Muted>
  );
}

/** The chosen plan in full: when, its steps, what it costs and where its power comes from, and its picture. */
function Chosen({
  c,
  s,
  asked,
  now,
  onPlan,
  pending,
}: {
  c: SuggestedCharge;
  s: Suggestions;
  asked: ChargeMode;
  now: number;
  onPlan: () => void;
  pending: boolean;
}) {
  const multiDay = midnight(c.start) !== midnight(c.end - 1);
  const figures: [string, string][] = [
    ["Costs", costWords(c.cost)],
    ["From solar", `${Math.round(c.solar_share * 100)}%`],
    ["From the home battery", c.battery_kwh >= 0.1 ? kWh(c.battery_kwh) : "none"],
    ["Takes it to", `${pct(c.soc_to)} (+${intAU(c.km)} km)`],
  ];
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line-subtle bg-surface p-5 max-sm:p-4">
      {c.kind !== asked && (
        <Muted>No {MODE[asked].label.toLowerCase()} plan gets there in time; this is the fastest.</Muted>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[15px] font-semibold tabular-nums">
            {when(c.start, now)} to {multiDay ? when(c.end, now) : hhmm(c.end)}{" "}
            {!multiDay && <span className="font-normal text-ink-muted">({duration(c.end - c.start)})</span>}
          </span>
          <span className="text-[13px] text-ink-muted">
            {c.steps.length > 1
              ? `${c.steps.length} steps, ${phaseWord(c.phases)}`
              : `${c.amps} A ${phaseWord(c.phases)} (${c.power_kw.toFixed(1)} kW)`}
            {c.battery_helps ? "" : " · the home battery stays out of it"}
          </span>
        </div>
        <Button size="sm" onClick={onPlan} disabled={pending}>
          Plan this charge
        </Button>
      </div>
      {c.steps.length > 1 && (
        <ol className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] tabular-nums">
          {c.steps.map((st) => (
            <li key={st.start} className="flex items-center gap-2.5">
              <span className="inline-block h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: COLOR.lilac }} />
              <span className={cn("text-ink", multiDay ? "w-[190px]" : "w-[104px]")}>
                {multiDay ? when(st.start, now) : hhmm(st.start)}–{hhmm(st.end)}
              </span>
              <span className="text-ink-muted">
                {st.amps} A ({st.power_kw.toFixed(1)} kW)
              </span>
            </li>
          ))}
        </ol>
      )}
      <dl className="m-0 grid grid-cols-4 gap-px overflow-hidden rounded-xl bg-line-subtle max-md:grid-cols-2">
        {figures.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5 bg-surface-inset px-4 py-3">
            <dt className="text-xs text-ink-muted">{k}</dt>
            <dd className="m-0 text-[15px] font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <Timeline c={c} s={s} />
      {c.steps.length > 1 && (
        <Muted>
          Changing the current at each step is up to you in the car's app, until the car can be controlled from here.
          The steps are on the planned charge too.
        </Muted>
      )}
    </div>
  );
}

/**
 * The plan against the spare solar: amber for solar the house isn't using, lilac for the car's charging, both in kW
 * on one scale, from now until it's needed.
 */
function Timeline({ c, s }: { c: SuggestedCharge; s: Suggestions }) {
  const t0 = Math.min(s.spare[0]?.start ?? c.start, c.start);
  const t1 = Math.max(s.ready_by, c.end);
  const span = Math.max(1, t1 - t0);
  const top = Math.max(1, ...s.spare.map((h) => h.kw), ...c.steps.map((st) => st.power_kw)) * 1.1;
  const x = (t: number) => `${((Math.max(t0, Math.min(t1, t)) - t0) / span) * 100}%`;
  const w = (a: number, b: number) => `${((Math.min(t1, b) - Math.max(t0, a)) / span) * 100}%`;
  const every = span > 60 * 3600 ? 12 : span > 30 * 3600 ? 6 : 3;
  const ticks: number[] = [];
  for (let t = Math.ceil(t0 / 3600) * 3600; t <= t1; t += 3600)
    if (new Date(t * 1000).getHours() % every === 0) ticks.push(t);
  return (
    <figure className="m-0 flex flex-col gap-2">
      <div
        role="img"
        aria-label={`Charging ${c.steps.map((st) => `${st.amps} A from ${hhmm(st.start)} to ${hhmm(st.end)}`).join(", ")}, against the spare solar`}
        className="relative h-24 border-b border-line"
      >
        {ticks.map((t) => (
          <span key={t} className="absolute inset-y-0 border-l border-line-subtle" style={{ left: x(t) }} />
        ))}
        {s.spare
          .filter((h) => h.kw > 0.05 && h.end > t0)
          .map((h) => (
            <span
              key={h.start}
              className="bar-grow absolute bottom-0"
              style={{
                left: x(h.start),
                width: w(h.start, h.end),
                height: `${(h.kw / top) * 100}%`,
                background: alpha(COLOR.solar, 0.3),
              }}
            />
          ))}
        {c.steps.map((st, k) => (
          <span
            key={st.start}
            title={`${hhmm(st.start)}–${hhmm(st.end)}: ${st.amps} A (${st.power_kw.toFixed(1)} kW)`}
            className="bar-grow absolute bottom-0 rounded-t-[4px] border-x-2 border-surface"
            style={
              {
                left: x(st.start),
                width: w(st.start, st.end),
                height: `${(st.power_kw / top) * 100}%`,
                background: alpha(COLOR.lilac, 0.85),
                "--i": k,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
      <div className="relative h-4 text-[11px] text-ink-faint tabular-nums">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: x(t) }}>
            {/* Midnight names the day, on a plan over several. */}
            {new Date(t * 1000).getHours() === 0 && span > 24 * 3600 ? weekdayShort(t) : hhmm(t)}
          </span>
        ))}
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-dim">
        <span className="flex items-center gap-1.5">
          <i className="size-2.5 rounded-[2px]" style={{ background: alpha(COLOR.lilac, 0.85) }} />
          Car charging
        </span>
        <span className="flex items-center gap-1.5">
          <i className="size-2.5 rounded-[2px]" style={{ background: alpha(COLOR.solar, 0.3) }} />
          Solar the house isn't using
        </span>
        <span className="text-ink-faint">kW, until {when(s.ready_by, s.spare[0]?.start ?? c.start)}</span>
      </figcaption>
    </figure>
  );
}

const weekdayShort = (ts: number) => new Date(ts * 1000).toLocaleDateString("en-AU", { weekday: "short" });

/** Every aim's plan side by side: when it's done, what it costs, and where its power comes from. */
function Compare({
  options,
  chosen,
  onChoose,
  now,
}: {
  options: SuggestedCharge[];
  chosen: ChargeMode | undefined;
  onChoose: (m: ChargeMode) => void;
  now: number;
}) {
  const sorted = MODES.map((m) => options.find((o) => o.kind === m)).filter((o): o is SuggestedCharge => !!o);
  const cheapest = Math.min(...sorted.map((o) => o.cost));
  return (
    <div className="flex flex-col gap-2 pt-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-[13px] tabular-nums">
          <thead>
            <tr className="text-left text-xs text-ink-muted">
              <th className="py-1.5 pr-3 font-medium">Aim</th>
              <th className="py-1.5 pr-3 font-medium">Charging</th>
              <th className="py-1.5 pr-3 text-right font-medium">Costs</th>
              <th className="py-1.5 pr-3 text-right font-medium">Solar</th>
              <th className="py-1.5 text-right font-medium">Home battery</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((o) => {
              const on = o.kind === chosen;
              return (
                <tr key={o.kind} className={cn("border-t border-line-subtle", on && "bg-fg/5")}>
                  <td className="py-2 pr-3">
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => onChoose(o.kind)}
                      className={cn(
                        "flex items-center gap-1.5 border-0 bg-transparent p-0 text-left",
                        on ? "font-semibold text-ink" : "text-ink-body hover:text-ink",
                      )}
                    >
                      {on && <Icon name="check" size={14} className="text-good" />}
                      {MODE[o.kind].label}
                    </button>
                  </td>
                  <td className="py-2 pr-3 text-ink-muted">
                    {when(o.start, now)} to {midnight(o.start) === midnight(o.end - 1) ? hhmm(o.end) : when(o.end, now)}
                    {o.steps.length > 1 ? ` · ${o.steps.length} steps` : ` · ${o.amps} A`}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {money(o.cost)}
                    {o.cost - cheapest >= 0.05 && (
                      <span className="block text-[11px] text-ink-faint">+{money(o.cost - cheapest)}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">{Math.round(o.solar_share * 100)}%</td>
                  <td className="py-2 text-right">{o.battery_kwh >= 0.1 ? kWh(o.battery_kwh) : "none"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A car on three phases can't charge below three times its lowest current: one phase follows the sun better. */
function SinglePhase({
  s,
  minKw,
  now,
  onPlan,
  pending,
}: {
  s: Suggestions;
  /** The least the car draws on three phases. */
  minKw: number;
  now: number;
  onPlan: (c: Plannable, now: number) => void;
  pending: boolean;
}) {
  const one = s.single_phase!;
  const best = s.options.find((o) => o.kind === "cheapest");
  return (
    <Notice tone="plain" className="flex flex-col gap-2">
      <span className="flex items-start gap-2">
        <span className="mt-0.5 text-ink">
          <Icon name="sun" size={16} />
        </span>
        <span className="text-pretty">
          <b className="font-medium text-ink">One phase would suit the sun better.</b> On three phases the car draws at
          least {minKw.toFixed(1)} kW, more than the spare solar. On {phaseWord(1)} from {when(one.start, now)} it would
          cost {costWords(one.cost)}
          {best ? `, ${money(best.cost - one.cost)} less,` : ""} and be {solarWords(one)}. That needs a single-phase
          charger or cable.
        </span>
      </span>
      <Button variant="outline" size="sm" className="self-start" onClick={() => onPlan(one, now)} disabled={pending}>
        Plan this charge
      </Button>
    </Notice>
  );
}
