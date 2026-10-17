import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { kWh, pct } from "~/features/common/formatting/utils/number";
import { COLOR, heatColor } from "~/features/common/theme/utils/colors";
import { addDays, midnight } from "~/features/common/time/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Icon } from "~/features/common/ui/components/Icon";
import { dim, usePick } from "~/features/common/ui/components/Pick";
import { CardText, SmallCard } from "~/features/common/ui/components/SmallCard";
import { cn } from "~/features/common/ui/utils";
import { historyQuery } from "~/features/ev/api";
import type { EvSession } from "~/features/ev/types";

const DAYS = 30;
const SHOWN = 5; // trips and charges listed before "Show all"

const day = (ts: number) => shortDay.format(new Date(ts * 1000));

/** The car's last 30 days of in and out (a Tesla's: its own readings keep them). */
const useHistory = (vin: string) => useQuery({ ...historyQuery(vin, DAYS), placeholderData: keepPreviousData });

/**
 * What the car took at home each of the last 30 days, as a strip of cells (a charge counts on the day it started),
 * with what it all came to in a line: how much, how much of it was sun or your battery, and how far it went. Pointing
 * at a day reads it out in the card's corner.
 */
export function EvDays({ vin, now, className }: { vin: string; now: number; className?: string }) {
  const { data: h } = useHistory(vin);
  const { picked, plot, item } = usePick<number>();
  if (!h) return null;
  const first = addDays(midnight(now), -(DAYS - 1));
  const days = Array.from({ length: DAYS }, (_, i) => {
    const start = addDays(first, i);
    const charges = h.sessions.filter(
      (s) => s.kind === "charge" && s.start >= start && s.start < addDays(start, 1) && (s.kwh ?? 0) > 0,
    );
    const kwh = charges.reduce((a, s) => a + (s.kwh ?? 0), 0);
    const grid = charges.reduce((a, s) => a + (s.grid_kwh ?? 0), 0);
    return { start, kwh, share: kwh >= 0.05 ? Math.max(0, 1 - grid / kwh) : null };
  });
  const max = Math.max(...days.map((d) => d.kwh));
  const t = h.totals;
  const p = picked != null ? days[picked] : null;
  return (
    <SmallCard
      id={`h-tdays-${vin}`}
      title={`Last ${DAYS} days`}
      note={
        <span aria-live="polite">
          {p
            ? `${day(p.start)} · ${p.kwh >= 0.05 ? `${kWh(p.kwh)}${p.share != null ? `, ${pct(p.share * 100)} sun` : ""}` : "No charge"}`
            : "kWh added a day"}
        </span>
      }
      className={className}
    >
      <div className="flex flex-col gap-1.5">
        <div
          className="grid h-[38px] gap-[3px]"
          style={{ gridTemplateColumns: `repeat(${DAYS}, minmax(0, 1fr))` }}
          {...plot}
        >
          {days.map((d, i) => (
            <button
              key={d.start}
              type="button"
              {...item(i)}
              aria-label={`${day(d.start)}: ${d.kwh >= 0.05 ? `added ${kWh(d.kwh)}` : "no charge"}`}
              className={cn("rounded-[4px] border-0 p-0", dim(picked, i))}
              style={{ background: heatColor(COLOR.danger, max > 0 ? d.kwh / max : 0) }}
            />
          ))}
        </div>
        <div aria-hidden className="flex justify-between text-[11px] text-ink-faint">
          <span>{day(first)}</span>
          <span>Today</span>
        </div>
      </div>
      <CardText>
        {t.charged_kwh < 0.05
          ? "It hasn't charged at home in the last 30 days."
          : `You added ${kWh(t.charged_kwh)} at home${
              t.solar_share != null ? `, ${pct(t.solar_share * 100)} of it from your sun or battery` : ""
            }.`}
        {t.km ? ` It went ${t.km.toLocaleString("en-AU")} km on ${t.trips} ${t.trips === 1 ? "trip" : "trips"}.` : ""}
        {t.kwh_per_100km ? ` That's ${t.kwh_per_100km} kWh per 100 km.` : ""}
      </CardText>
    </SmallCard>
  );
}

const levels = (s: EvSession) =>
  s.soc_start != null && s.soc_end != null ? `${Math.round(s.soc_start)}% → ${Math.round(s.soc_end)}%` : null;

function duration(s: number): string {
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h${m % 60 ? ` ${m % 60} min` : ""}` : `${Math.round(h / 24)} days`;
}

/** One trip or charge, in a row: what it was, its levels and what it came to, and when. */
function Row({ s, now }: { s: EvSession; now: number }) {
  const away = s.kind === "away";
  const what = away
    ? s.end == null
      ? `Out since ${hhmm(s.start)}`
      : [levels(s), s.km ? `${Math.round(s.km)} km` : null].filter(Boolean).join(" · ")
    : [
        s.end == null ? "Charging now" : levels(s),
        s.kwh != null ? kWh(s.kwh) : null,
        s.solar_share != null ? `${Math.round(s.solar_share * 100)}% sun` : null,
      ]
        .filter(Boolean)
        .join(" · ");
  return (
    <li className="flex items-center gap-3 rounded-xl border border-line-subtle bg-fg/3 px-3 py-2.5">
      <span className="flex flex-none" style={{ color: away ? COLOR.battery : COLOR.good }}>
        <Icon name={away ? "car" : "bolt"} size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] font-medium">{away ? "Out" : "Charged at home"}</span>
        {what && <span className="truncate text-xs text-ink-muted tabular-nums">{what}</span>}
      </span>
      <span className="flex flex-none flex-col items-end text-xs text-ink-faint tabular-nums">
        <span>{day(s.start)}</span>
        <span>{duration((s.end ?? now) - s.start)}</span>
      </span>
    </li>
  );
}

/** The car's trips and charges at home over the last 30 days, latest first: a few, then all of them on a tap. */
export function EvTrips({ vin, now, className }: { vin: string; now: number; className?: string }) {
  const { data: h, isPending } = useHistory(vin);
  const [all, setAll] = useState(false);
  const t = h?.totals;
  const sessions = h?.sessions ?? [];
  return (
    <SmallCard
      id={`h-ttrips-${vin}`}
      title="Trips and charges"
      note={
        t
          ? `${t.trips} ${t.trips === 1 ? "trip" : "trips"} · ${t.charges} ${t.charges === 1 ? "charge" : "charges"}`
          : undefined
      }
      className={className}
    >
      {!isPending && sessions.length === 0 && (
        <CardText>Nothing yet. Charges at home and trips out will show up here.</CardText>
      )}
      {sessions.length > 0 && (
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {(all ? sessions : sessions.slice(0, SHOWN)).map((s) => (
            <Row key={s.id} s={s} now={now} />
          ))}
        </ol>
      )}
      {sessions.length > SHOWN && (
        <Button variant="muted-link" size="sm" className="self-start" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${sessions.length}`}
        </Button>
      )}
    </SmallCard>
  );
}
