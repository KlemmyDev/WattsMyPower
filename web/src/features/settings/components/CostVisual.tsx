import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { insightsQuery } from "~/features/battery/api";
import { paybackQuery } from "~/features/bills/api";
import { monthYear } from "~/features/common/formatting/utils/date";
import { dollars } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { nowS } from "~/features/common/time/utils";
import { cn } from "~/features/common/ui/utils";

const YEAR = 365.25 * 86_400;

/** The figures as the form has them, not saved yet: 0 for not set, dates in unix seconds. */
export type CostFigures = {
  cost: number;
  installed: number;
  batteryInstalled: number;
  warrantyYears: number;
  warrantyMwh: number;
};

const month = (ts: number) => monthYear.format(new Date(ts * 1000));

/** How much of the system has paid for itself, as a ring, with what's saved and when it pays off beside it. */
function PaybackRing({ pct, children }: { pct: number | null; children: ReactNode }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const shown = pct == null ? 0 : Math.min(pct, 100);
  return (
    <div className="flex flex-wrap items-center gap-x-7 gap-y-4">
      <div className="relative size-[132px] flex-none">
        <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
          <circle cx="60" cy="60" r={r} fill="none" stroke={COLOR.track} strokeWidth="10" />
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            opacity={shown > 0 ? 1 : 0}
            stroke={COLOR.good}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${(shown / 100) * c} ${c}`}
            className="transition-[stroke-dasharray] duration-700 ease-out-soft"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[28px] leading-8 font-light tracking-[-0.6px] tabular-nums">
            {pct == null ? "—" : `${Math.round(pct)}%`}
          </span>
          <span className="text-[11px] text-ink-muted">paid back</span>
        </div>
      </div>
      <div className="flex min-w-[180px] flex-1 flex-col gap-3">{children}</div>
    </div>
  );
}

function Figure({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="text-[17px] leading-6 font-light tracking-[-0.2px] tabular-nums">{value}</span>
      {sub && <span className="text-[11px] text-ink-faint">{sub}</span>}
    </div>
  );
}

type Mark = { at: number; label: string; color: string; hollow?: boolean };

/**
 * The system's life on one line, from when it went in: today, when it pays for itself, and when the battery's warranty
 * ends, each a dot with its month under it. The part already lived is filled.
 */
function Lifeline({ from, marks }: { from: number; marks: Mark[] }) {
  const now = nowS();
  const end = Math.max(now + YEAR, ...marks.map((m) => m.at)) + YEAR / 4;
  const x = (t: number) => Math.min(Math.max(((t - from) / (end - from)) * 100, 0), 100);
  const all: Mark[] = [{ at: from, label: "Installed", color: COLOR.inkMuted }, ...marks].sort((a, b) => a.at - b.at);
  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-3">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-track" />
        <div
          className="absolute top-1/2 left-0 h-1 origin-left -translate-y-1/2 animate-fill-x rounded-full"
          style={{ width: `${x(now)}%`, background: alpha(COLOR.good, 0.7) }}
        />
        {all.map((m) => (
          <span
            key={m.label}
            title={`${m.label}: ${month(m.at)}`}
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
            style={{
              left: `${x(m.at)}%`,
              background: m.hollow ? "var(--color-surface)" : m.color,
              boxShadow: m.hollow ? `inset 0 0 0 2px ${m.color}` : undefined,
            }}
          />
        ))}
      </div>
      {/* The labels under the line, each kept inside it (the first and last lean in). */}
      <div className="relative h-9">
        {all.map((m, i) => {
          const at = x(m.at);
          return (
            <div
              key={m.label}
              className={cn(
                "absolute top-0 flex flex-col text-[11px] leading-4 whitespace-nowrap",
                at < 12 ? "items-start" : at > 88 ? "-translate-x-full items-end" : "-translate-x-1/2 items-center",
                // Alternate rows when two would touch.
                i % 2 === 1 && Math.abs(at - x(all[i - 1].at)) < 18 && "top-[18px]",
              )}
              style={{ left: `${at}%` }}
            >
              <span className="font-medium text-ink">{m.label}</span>
              <span className="text-ink-faint tabular-nums">{month(m.at)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A bar of how much of something is used, with what it is and the figures on its line. */
function UsedBar({ label, pct, note, color }: { label: string; pct: number; note: string; color: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between gap-3 text-[13px]">
        <span>{label}</span>
        <span className="text-ink-muted tabular-nums">{note}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-track">
        <div
          className="h-full origin-left animate-fill-x rounded-full"
          style={{ width: `${Math.min(pct, 100)}%`, background: color }}
        />
      </div>
    </div>
  );
}

/**
 * Settings → Cost and warranty, the picture: how much of the system has paid for itself, its life from install to
 * paying off and the battery's warranty ending, and the warranty's energy used. Figures not saved yet show as they'd be.
 */
export function CostVisual({ figures: f }: { figures: CostFigures }) {
  const p = useQuery(paybackQuery).data;
  const w = useQuery(insightsQuery).data?.warranty;
  const now = nowS();
  const saved = p?.saved_total ?? null;
  const pct = f.cost && saved != null ? (saved / f.cost) * 100 : null;
  const perYear = p?.per_year ?? null;
  // When it pays off at the rate it's saving: from what's left of the cost, as typed.
  const paysAt =
    f.cost && saved != null
      ? saved >= f.cost
        ? null
        : perYear
          ? now + ((f.cost - saved) / perYear) * YEAR
          : null
      : null;
  const batteryFrom = f.batteryInstalled || f.installed;
  const warrantyEnds = batteryFrom && f.warrantyYears ? batteryFrom + f.warrantyYears * YEAR : null;

  const marks: Mark[] = [{ at: now, label: "Today", color: COLOR.ink }];
  if (paysAt) marks.push({ at: paysAt, label: "Pays for itself", color: COLOR.good, hollow: true });
  if (warrantyEnds)
    marks.push({ at: warrantyEnds, label: "Warranty ends", color: COLOR.battery, hollow: warrantyEnds > now });

  return (
    <>
      <PaybackRing pct={pct}>
        <Figure
          label="Saved so far"
          value={saved != null ? dollars(saved) : "—"}
          sub={p?.saved_before ? `${dollars(p.saved_before)} of it estimated, from before your readings` : undefined}
        />
        <Figure
          label="Pays for itself"
          value={
            !f.cost
              ? "Add what it cost"
              : pct != null && pct >= 100
                ? "Already has"
                : paysAt
                  ? `Around ${month(paysAt)}`
                  : "Needs 30 days of readings"
          }
          sub={perYear ? `Saving about ${dollars(perYear)} a year` : undefined}
        />
      </PaybackRing>
      {f.installed ? (
        <div className="flex flex-col gap-2 border-t border-line-subtle pt-5">
          <span className="text-[13px] font-semibold">Its life so far</span>
          <Lifeline from={f.installed} marks={marks} />
        </div>
      ) : (
        <div className="rounded-2xl bg-canvas/60 px-4 py-3 text-[13px] text-ink-muted light:bg-canvas">
          Add when it was installed to see its life from then: today, when it pays for itself, and when the battery's
          warranty ends.
        </div>
      )}
      {(!!warrantyEnds || (f.warrantyMwh > 0 && w?.used_mwh != null)) && (
        <div className="flex flex-col gap-3 border-t border-line-subtle pt-5">
          <span className="text-[13px] font-semibold">The battery's warranty</span>
          {warrantyEnds && batteryFrom && (
            <UsedBar
              label="Years"
              color={COLOR.battery}
              pct={((now - batteryFrom) / (warrantyEnds - batteryFrom)) * 100}
              note={`${((now - batteryFrom) / YEAR).toFixed(1)} of ${f.warrantyYears} years`}
            />
          )}
          {f.warrantyMwh > 0 && w?.used_mwh != null && (
            <UsedBar
              label="Energy delivered"
              color={COLOR.battery}
              pct={(w.used_mwh / f.warrantyMwh) * 100}
              note={`${w.used_mwh} of ${f.warrantyMwh} MWh`}
            />
          )}
        </div>
      )}
    </>
  );
}
