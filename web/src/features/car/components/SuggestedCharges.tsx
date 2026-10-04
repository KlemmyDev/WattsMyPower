import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { suggestQuery } from "~/features/car/api";
import { useChargeChange } from "~/features/car/hooks";
import type { CarView, SuggestedCharge, SuggestRequest, Suggestions } from "~/features/car/types";
import { costWords, fromLocal, nextReadyBy, phaseWord, solarWords, toLocal, when } from "~/features/car/utils";
import { errorMessage } from "~/features/common/api/utils";
import { duration, hhmm } from "~/features/common/formatting/utils/date";
import { intAU, kWh, kWhInt, money, pct } from "~/features/common/formatting/utils/number";
import { Button } from "~/features/common/ui/components/Button";
import { Muted } from "~/features/common/ui/components/Card";
import { Field, HelpText, Input, Select } from "~/features/common/ui/components/Field";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { Pill } from "~/features/common/ui/components/Pill";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { useToast } from "~/features/common/ui/components/Toast";

const KIND: Record<SuggestedCharge["kind"], { label: string; tone: "good" | "brand" | "neutral" }> = {
  best: { label: "Best", tone: "good" },
  solar: { label: "Most solar", tone: "brand" },
  now: { label: "Start now", tone: "neutral" },
};

/** Plan a suggested charge as it stands, then say so. */
function usePlanSuggestion(view: CarView, s: Suggestions | undefined) {
  const { add } = useChargeChange();
  const toast = useToast();
  const plan = (c: Omit<SuggestedCharge, "kind">, now: number) =>
    add.mutate(
      {
        start: c.start,
        amps: c.amps,
        phases: c.phases,
        soc_now: c.soc_from,
        soc_to: c.soc_to,
        hours: null,
        battery_helps: !!view.car.car_battery_helps,
        // Starting from where an earlier planned charge leaves it isn't the car's level now.
        level_now: s?.planned_soc == null,
      },
      { onSuccess: () => toast(`Charge planned for ${when(c.start, now)}. Set it in the car's app.`) },
    );
  return { plan, pending: add.isPending, error: add.isError ? errorMessage(add.error) : "" };
}

/** One suggested charge: when, how fast, what it adds, what it costs and where its power comes from. */
function Option({
  c,
  kind,
  best,
  now,
  onPlan,
  pending,
}: {
  c: Omit<SuggestedCharge, "kind">;
  kind?: SuggestedCharge["kind"];
  best?: SuggestedCharge;
  now: number;
  onPlan: () => void;
  pending: boolean;
}) {
  const more = best && kind !== "best" ? c.cost - best.cost : 0;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle py-3.5 first:border-t-0 first:pt-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink tabular-nums">
          {kind && (
            <Pill tone={KIND[kind].tone} size="sm">
              {KIND[kind].label}
            </Pill>
          )}
          {when(c.start, now)} to {hhmm(c.end)}
          <span className="font-normal text-ink-muted">({duration(c.end - c.start)})</span>
        </span>
        <span className="text-[13px] text-pretty text-ink-muted tabular-nums">
          {c.amps} A {phaseWord(c.phases)} ({c.power_kw.toFixed(1)} kW) · {pct(c.soc_from)} → {pct(c.soc_to)} · adds
          about {intAU(c.km)} km
        </span>
        <span className="text-[13px] text-pretty text-ink-muted tabular-nums">
          Costs {costWords(c.cost)}
          {more >= 0.05 && ` (${money(more)} more)`} · {solarWords(c)}
        </span>
      </div>
      <Button variant={kind === "best" ? "primary" : "outline"} size="sm" onClick={onPlan} disabled={pending}>
        Plan this charge
      </Button>
    </li>
  );
}

type ReadyChoice = "next" | "after" | "other";

/**
 * Suggested charges for a connected car: from its level now (as last given, or typed here) to a level by a time,
 * the best start and current for the least on the bill, and how it compares to starting now. Key it by when the
 * level was last given, so a new one starts the form afresh.
 */
export function SuggestedCharges({ view, now }: { view: CarView; now: number }) {
  const c = view.car;
  const level = view.level?.soc;
  const [socNow, setSocNow] = useState(level == null ? "" : String(Math.round(level)));
  const [socTo, setSocTo] = useState(String(c.car_target_soc));
  const [ready, setReady] = useState<ReadyChoice>("next");
  const next = nextReadyBy(now, c.car_ready_by);
  const after = nextReadyBy(now, c.car_ready_by, 1);
  const [other, setOther] = useState(() => toLocal(after + 10.5 * 3600));

  const num = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? undefined : Number(v));
  const req: SuggestRequest = {
    soc_now: num(socNow),
    soc_to: num(socTo),
    ready_by: ready === "next" ? next : ready === "after" ? after : other ? fromLocal(other) : undefined,
  };
  // Suggestions follow the form, a moment after typing stops.
  const key = JSON.stringify(req);
  const [asked, setAsked] = useState(req);
  useEffect(() => {
    const t = setTimeout(() => setAsked(JSON.parse(key)), 300);
    return () => clearTimeout(t);
  }, [key]);
  const can = asked.soc_now != null && asked.soc_to != null && asked.ready_by != null;
  const q = useQuery({ ...suggestQuery(asked), enabled: can, placeholderData: keepPreviousData });
  const s = q.data;
  const { plan, pending, error } = usePlanSuggestion(view, s);
  const best = s?.options.find((o) => o.kind === "best");

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-surface-inset p-5 max-sm:p-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[15px] font-semibold">Best times to charge</h3>
        <Muted>
          From the solar forecast, your home use and your rates. Set the start time and current in the car's app.
        </Muted>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] items-start gap-4">
        <Field label="The car's charge now">
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            max="100"
            unit="%"
            value={socNow}
            placeholder="e.g. 40"
            onChange={(e) => setSocNow(e.target.value)}
          />
        </Field>
        <Field label="Charge to">
          <Input
            type="number"
            inputMode="decimal"
            min="1"
            max="100"
            unit="%"
            value={socTo}
            onChange={(e) => setSocTo(e.target.value)}
          />
        </Field>
        <Field label="Needed by">
          <Select value={ready} onChange={(e) => setReady(e.target.value as ReadyChoice)}>
            <option value="next">{when(next, now)}</option>
            <option value="after">{when(after, now)}</option>
            <option value="other">Another time…</option>
          </Select>
        </Field>
        {ready === "other" && (
          <Field label="At" help="Up to the end of the day after tomorrow.">
            <Input type="datetime-local" value={other} onChange={(e) => setOther(e.target.value)} />
          </Field>
        )}
      </div>
      {!can ? (
        <Muted>Give the car's charge now to see the best times to charge it.</Muted>
      ) : q.isError ? (
        <HelpText tone="bad">{errorMessage(q.error)}</HelpText>
      ) : !s ? (
        <Skeleton className="h-[140px]" />
      ) : (
        <div className="flex flex-col gap-4" aria-busy={q.isFetching}>
          <Summary s={s} now={now} />
          {s.options.length > 0 && (
            <ul className="flex flex-col">
              {s.options.map((o) => (
                <Option
                  key={o.kind}
                  c={o}
                  kind={o.kind}
                  best={best}
                  now={now}
                  onPlan={() => plan(o, now)}
                  pending={pending}
                />
              ))}
            </ul>
          )}
          {s.single_phase && best && (
            <SinglePhase
              s={s}
              best={best}
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

/** What the car needs and what's there to give it, before the options. */
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
          ? ` About ${kWhInt(s.spare_kwh)} of spare solar is forecast before then.`
          : " Little spare solar is forecast before then.")}
    </Muted>
  );
}

/** A car on three phases can't charge below three times its lowest current: one phase follows the sun better. */
function SinglePhase({
  s,
  best,
  minKw,
  now,
  onPlan,
  pending,
}: {
  s: Suggestions;
  best: SuggestedCharge;
  /** The least the car draws on three phases. */
  minKw: number;
  now: number;
  onPlan: (c: Omit<SuggestedCharge, "kind">, now: number) => void;
  pending: boolean;
}) {
  const one = s.single_phase!;
  return (
    <Notice tone="plain" className="flex flex-col gap-2">
      <span className="flex items-start gap-2">
        <span className="mt-0.5 text-ink">
          <Icon name="sun" size={16} />
        </span>
        <span className="text-pretty">
          <b className="font-medium text-ink">One phase would suit the sun better.</b> On three phases the car draws at
          least {minKw.toFixed(1)} kW, more than the spare solar. At {one.amps} A {phaseWord(1)} from{" "}
          {when(one.start, now)} it would cost {costWords(one.cost)}, {money(best.cost - one.cost)} less, and be{" "}
          {solarWords(one)}. That needs a single-phase charger or cable.
        </span>
      </span>
      <Button variant="outline" size="sm" className="self-start" onClick={() => onPlan(one, now)} disabled={pending}>
        Plan this charge
      </Button>
    </Notice>
  );
}
