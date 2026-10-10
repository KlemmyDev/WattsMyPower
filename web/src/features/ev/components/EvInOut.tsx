import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { kWh } from "~/features/common/formatting/utils/number";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { cn } from "~/features/common/ui/utils";
import { historyQuery } from "~/features/ev/api";
import type { EvSession } from "~/features/ev/types";

const RANGES = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
] as const;

const when = (ts: number) => `${shortDay.format(new Date(ts * 1000))}, ${hhmm(ts)}`;

function duration(s: number): string {
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h${m % 60 ? ` ${m % 60} min` : ""}` : `${Math.round(h / 24)} days`;
}

const levels = (s: EvSession) =>
  s.soc_start != null && s.soc_end != null ? `${Math.round(s.soc_start)}% → ${Math.round(s.soc_end)}%` : null;

/** One session, in a line: time away and what it used (or gained), or a charge and how much of it was solar. */
function Line({ s, now }: { s: EvSession; now: number }) {
  const away = s.kind === "away";
  const change = s.soc_change;
  const what = away
    ? s.end == null
      ? `Away since ${hhmm(s.start)}, left at ${Math.round(s.soc_start ?? 0)}%`
      : [
          levels(s),
          change != null && (change <= 0 ? `used ${Math.round(-change)}%` : `gained ${Math.round(change)}%`),
          s.used_kwh ? `about ${kWh(Math.abs(s.used_kwh))}` : null,
          s.km ? `${Math.round(s.km)} km` : null,
          s.kwh_per_100km ? `${s.kwh_per_100km} kWh/100 km` : null,
        ]
          .filter(Boolean)
          .join(" · ")
    : [
        s.end == null ? "Charging now" : levels(s),
        s.kwh != null ? kWh(s.kwh) : null,
        s.solar_share != null ? `${Math.round(s.solar_share * 100)}% solar or battery` : null,
      ]
        .filter(Boolean)
        .join(" · ");
  return (
    <li className="flex items-start gap-3 border-b border-line-subtle py-3 last:border-b-0">
      <span
        className="flex size-8 flex-none items-center justify-center rounded-full bg-canvas"
        style={{ color: away ? COLOR.battery : COLOR.good }}
      >
        <Icon name={away ? "car" : "bolt"} size={16} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-pretty tabular-nums">
          <span className="font-medium">{away ? "Away" : "Charged at home"}</span>
          {what && <span className="text-ink-muted"> · {what}</span>}
        </span>
        <span className="text-xs text-ink-faint tabular-nums">
          {when(s.start)}
          {` · ${duration((s.end ?? now) - s.start)}`}
        </span>
      </span>
    </li>
  );
}

/**
 * The car's in and out, as the home battery has its own: each time it was away (its level leaving and back, what
 * that is in kWh, and how far it went) and each charge at home (from the house, and how much was solar or the home
 * battery rather than the grid), with their totals.
 */
export function EvInOut({ vin, now, className }: { vin: string; now: number; className?: string }) {
  const [days, setDays] = useState<(typeof RANGES)[number]["value"]>("30");
  const { data: h, isPending } = useQuery({ ...historyQuery(vin, Number(days)), placeholderData: keepPreviousData });
  const t = h?.totals;
  return (
    <Card aria-labelledby={`h-tio-${vin}`} className={cn("gap-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TitleBlock id={`h-tio-${vin}`} title="In and out" sub="Charges at home, and what it used while it was away" />
        <Segmented label="Period" options={[...RANGES]} value={days} onChange={setDays} />
      </div>
      {t && (
        // Four across when the card has room for them, two by two when it doesn't (beside Charging, or on a phone).
        <div className="@container">
          <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
            <Stat label="Charged at home" value={kWh(t.charged_kwh)}>
              {t.solar_share != null ? `${Math.round(t.solar_share * 100)}% solar or battery` : `${t.charges} charges`}
            </Stat>
            <Stat label="From the grid" value={kWh(t.grid_kwh)}>
              {t.charges} {t.charges === 1 ? "charge" : "charges"}
            </Stat>
            <Stat label="Driven" value={t.km != null ? `${t.km.toLocaleString("en-AU")} km` : "—"}>
              {t.trips} {t.trips === 1 ? "trip" : "trips"}
            </Stat>
            <Stat label="Used" value={t.kwh_per_100km != null ? `${t.kwh_per_100km}` : "—"}>
              kWh per 100 km
            </Stat>
          </div>
        </div>
      )}
      {h && h.battery_kwh == null && (
        <p className="m-0 text-[13px] text-ink-muted">
          Set the car's battery size (Integrations → Tesla → Details) to see what it used in kWh.
        </p>
      )}
      {!isPending && h?.sessions.length === 0 && (
        <p className="m-0 text-sm text-ink-muted">
          Nothing yet. Each charge at home, and each time it's away and back, shows here.
        </p>
      )}
      {h && h.sessions.length > 0 && (
        <ol className="m-0 flex list-none flex-col p-0">
          {h.sessions.map((s) => (
            <Line key={s.id} s={s} now={now} />
          ))}
        </ol>
      )}
    </Card>
  );
}

function Stat({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-2xl border border-line-subtle p-3">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="text-xl font-light tabular-nums">{value}</span>
      <span className="text-xs text-ink-faint">{children}</span>
    </div>
  );
}
