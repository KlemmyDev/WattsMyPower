import type { ReactNode } from "react";
import { DASH, dollars, kWh, kWhInt, money, pct, signedPct } from "~/features/common/formatting/utils/number";
import { COLOR } from "~/features/common/theme/utils/colors";
import {
  HeroBar,
  HeroCard,
  HeroFigures,
  HeroFill,
  HeroKey,
  HeroLead,
  HeroLive,
  HeroStat,
  HeroStats,
  HeroTick,
  HeroTop,
} from "~/features/common/ui/components/Hero";
import { Delta } from "~/features/common/ui/components/Live";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { cn } from "~/features/common/ui/utils";
import { MonthBars, SOURCES } from "~/features/history/components/MonthBars";
import type { Month, Totals } from "~/features/history/utils/year";

const TINT = COLOR.lilac;

/** Dollars, with cents while it's small: "$8.40", "$1,240". */
const cash = (v: number) => (Math.abs(v) >= 100 ? dollars(v) : money(v));

/** How much of the house's use solar and the battery covered, 0–1; null without any use. */
const selfOf = (t: Totals) => (t.home > 0 ? Math.max(0, Math.min(1, (t.home - t.imp) / t.home)) : null);

/**
 * The year in one card, as Solar's, Home's and Battery's lead with today: how much of the house's use solar and the
 * battery covered (against the same stretch of the year before), what that saved and what power cost all up, what was
 * made, used, bought and sold; where the house's power came from along a bar; and the year a month at a time, each
 * month opening its days. The year to show is picked in its corner.
 */
export function HistoryHero({
  year,
  years,
  onYear,
  span,
  note,
  loaded,
  running,
  totals,
  prev,
  months,
  onMonth,
}: {
  year: number;
  /** The years there's history for, newest first. */
  years: number[];
  onYear: (y: number) => void;
  /** What it covers: "1 Jan to 12 Oct 2026". */
  span: string;
  /** What to say when there's nothing yet. */
  note?: string;
  loaded: boolean;
  /** This year: still filling in. */
  running: boolean;
  totals: Totals;
  /** The same stretch of the year before, when there's as much of it to go on. */
  prev: Totals | null;
  months: Month[];
  onMonth: (m: Month) => void;
}) {
  const self = selfOf(totals);
  const before = prev ? selfOf(prev) : null;
  const savedChange = prev && prev.saved > 1 ? (totals.saved - prev.saved) / prev.saved : null;
  const perDay = (v: number) => `${kWh(v / totals.days)} a day`;
  return (
    <HeroCard label={`History for ${year}`} tint={TINT}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 @max-xl:-order-3">
        <span className="text-[13px] text-ink-muted tabular-nums">{span}</span>
        {years.length > 1 && (
          <div className="max-w-full [scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden">
            <Segmented
              label="Year"
              role="tablist"
              options={years.map((y) => ({ value: String(y), label: y }))}
              value={String(year)}
              onChange={(v) => onYear(Number(v))}
              buttonClassName="px-3 py-1.5 text-[13px]"
            />
          </div>
        )}
      </div>
      {!loaded ? (
        <Skeleton className="h-[420px] rounded-2xl" />
      ) : !totals.days ? (
        <div className="text-[13px] text-pretty text-ink-faint">{note}</div>
      ) : (
        <>
          <HeroTop>
            <HeroFigures>
              <HeroLead
                label="Self-sufficiency"
                value={self == null ? DASH : Math.round(self * 100)}
                unit={self == null ? undefined : "%"}
                sub={
                  <>
                    {self != null && self >= 0.995
                      ? `All ${kWhInt(totals.home)} from solar and the battery`
                      : `${kWhInt(Math.max(0, totals.home - totals.imp))} of ${kWhInt(totals.home)} from solar and the battery`}
                    {self != null && before != null && (
                      <Delta value={self - before}>{points(self - before, year - 1)}</Delta>
                    )}
                  </>
                }
              />
              <HeroLive
                label="Saved"
                on={running}
                color={COLOR.good}
                value={cash(totals.saved)}
                sub={
                  <>
                    {totals.net >= 0 ? `Power cost you ${cash(totals.net)}` : `You came out ${cash(-totals.net)} ahead`}
                    {savedChange != null && (
                      <Delta value={savedChange}>
                        {signedPct(savedChange)} on {year - 1}
                      </Delta>
                    )}
                  </>
                }
              />
            </HeroFigures>
            <HeroStats>
              <HeroStat label="Made" value={kWhInt(totals.gen)} sub={perDay(totals.gen)} />
              <HeroStat label="Used" value={kWhInt(totals.home)} sub={perDay(totals.home)} />
              <HeroStat label="Bought" value={kWhInt(totals.imp)} sub={`${cash(totals.cost)} of power`} />
              <HeroStat label="Sold" value={kWhInt(totals.exp)} sub={`${cash(totals.credit)} back`} />
            </HeroStats>
          </HeroTop>
          <SourceBar totals={totals} before={before} beforeLabel={running ? `${year - 1} by now` : String(year - 1)} />
          <MonthBars year={year} months={months} onSelect={onMonth} />
        </>
      )}
    </HeroCard>
  );
}

/** A change in percentage points on a year: "+5 pts on 2025", or "Same as 2025". */
function points(v: number, year: number): string {
  const r = Math.round(v * 100);
  return r === 0 ? `Same as ${year}` : `${r > 0 ? "+" : "−"}${Math.abs(r)} pts on ${year}`;
}

/**
 * Where the house's power came from, along one bar out of everything it used: solar straight from the panels, the
 * battery, the grid; and a tick where the year before's self-sufficiency reached.
 */
function SourceBar({ totals, before, beforeLabel }: { totals: Totals; before: number | null; beforeLabel: string }) {
  const parts = SOURCES.map((s) => ({ ...s, kwh: totals[s.key] })).filter((s) => s.kwh > 0.005);
  const whole = parts.reduce((a, s) => a + s.kwh, 0) || 1;
  // Where each part ends along the bar, in %: it and the parts before it, added up.
  const ends = parts.map((_, k) => (parts.slice(0, k + 1).reduce((a, s) => a + s.kwh, 0) / whole) * 100);
  const fills: ReactNode[] = parts.map((s, k) => (
    <HeroFill
      key={s.key}
      from={k ? ends[k - 1] : 0}
      to={ends[k]}
      color={s.color}
      className={cn(
        parts.length > 1 && k === 0 && "rounded-r-none",
        parts.length > 1 && k === parts.length - 1 && "rounded-l-none",
        k > 0 && k < parts.length - 1 && "rounded-none",
      )}
    />
  ));
  return (
    <HeroBar
      legend={
        <>
          {parts.map((s) => (
            <HeroKey key={s.key} mark="dot" color={s.color}>
              {s.label} {pct((s.kwh / whole) * 100)} · {kWhInt(s.kwh)}
            </HeroKey>
          ))}
          {before != null && (
            <HeroKey mark="tick">
              {beforeLabel}, {pct(before * 100)}
            </HeroKey>
          )}
        </>
      }
    >
      {fills}
      {before != null && <HeroTick at={before * 100} title="Self-sufficiency the year before" />}
    </HeroBar>
  );
}
