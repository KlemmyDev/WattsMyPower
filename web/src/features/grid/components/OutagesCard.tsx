import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { intAU } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Select } from "~/features/common/ui/components/Field";
import { useSaveSettings } from "~/features/common/settings/hooks";
import { Pill } from "~/features/common/ui/components/Pill";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { cn } from "~/features/common/ui/utils";
import type { Outage, OutagesView } from "~/features/grid/types";

/** Outages now, and planned work: the colours they take on the radar and in the lists. */
export const UNPLANNED = COLOR.warn;
export const PLANNED = COLOR.lilac;

const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** The distances the radius can be set to (Settings → Integrations → Grid has the same). */
export const RADII = [5, 10, 15, 20, 30, 50];

export const suburbsOf = (o: Outage) => {
  const names = o.suburbs.map(title);
  return names.length
    ? names.length > 2
      ? `${names.slice(0, 2).join(", ")} +${names.length - 2}`
      : names.join(", ")
    : "Area not given";
};

/** "Today 8 am to 3 pm", "Fri 10 Oct, 8 am to 2 pm", or until the network's words ("Under investigation"). */
export function when(o: Outage, now: number): string {
  const day = (t: number) =>
    new Date(t * 1000).toDateString() === new Date(now * 1000).toDateString()
      ? "Today"
      : shortDay.format(new Date(t * 1000));
  const end = o.end ? hhmm(o.end) : o.end_text ? title(o.end_text) : "not known";
  if (!o.start) return `Back ${end}`;
  if (o.start <= now && !o.planned)
    return o.end ? `Since ${hhmm(o.start)}, back by ${end}` : `Since ${hhmm(o.start)} · ${end}`;
  return `${day(o.start)}, ${hhmm(o.start)} to ${end}`;
}

/** Where each outage sits around the house: the house in the middle, rings at thirds of the radius. */
function Radar({
  list,
  radius,
  home,
  hover,
  onHover,
}: {
  list: Outage[];
  radius: number;
  home: { lat: number; lon: number };
  hover: string | null;
  onHover: (id: string | null) => void;
}) {
  const R = 100;
  const kmPerLat = 111.32;
  const kmPerLon = 111.32 * Math.cos((home.lat * Math.PI) / 180);
  const place = (o: Outage) => {
    const dx = (o.lon - home.lon) * kmPerLon;
    const dy = (o.lat - home.lat) * kmPerLat;
    const d = Math.hypot(dx, dy);
    const k = d > radius ? radius / d : 1; // the ones reaching the house from further away sit on the edge
    return { x: (dx * k * R) / radius, y: (-dy * k * R) / radius };
  };
  const size = (o: Outage) => 3 + Math.min(6, Math.sqrt(o.customers ?? 1) / 3);
  return (
    <svg
      viewBox="-112 -112 224 224"
      className="aspect-square w-full max-w-[240px] flex-none"
      role="img"
      aria-label="Outages around your house"
    >
      {[1, 2, 3].map((i) => (
        <circle
          key={i}
          r={(R * i) / 3}
          fill="none"
          style={{ stroke: alpha(COLOR.fg, i === 3 ? 0.14 : 0.07) }}
          strokeWidth="1"
        />
      ))}
      <line x1="0" y1={-R} x2="0" y2={R} style={{ stroke: alpha(COLOR.fg, 0.05) }} />
      <line x1={-R} y1="0" x2={R} y2="0" style={{ stroke: alpha(COLOR.fg, 0.05) }} />
      <text x="0" y={-R - 4} textAnchor="middle" className="fill-ink-faint text-[9px]">
        N
      </text>
      <text x={R - 2} y="-4" textAnchor="end" className="fill-ink-faint text-[8.5px]">
        {radius} km
      </text>
      {/* Planned work first, so an outage in the same place is drawn over it. */}
      {[...list]
        .sort((a, b) => Number(!a.planned) - Number(!b.planned))
        .map((o) => {
          const p = place(o);
          const c = o.planned ? PLANNED : UNPLANNED;
          const on = hover === o.id;
          return (
            <g
              key={o.id}
              onPointerEnter={() => onHover(o.id)}
              onPointerLeave={() => onHover(null)}
              className="cursor-default"
            >
              <title>{`${suburbsOf(o)} · ${o.distance_km} km ${o.direction}`}</title>
              {o.affects && (
                <circle cx={p.x} cy={p.y} r={size(o) + 4} fill="none" style={{ stroke: c }} strokeWidth="1.5" />
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={size(o) + (on ? 1.5 : 0)}
                style={{ fill: alpha(c, on ? 0.95 : 0.75), stroke: "var(--color-surface)" }}
                strokeWidth="1.5"
              />
            </g>
          );
        })}
      <circle r="5" style={{ fill: COLOR.ink, stroke: "var(--color-surface)" }} strokeWidth="2" />
    </svg>
  );
}

function Row({
  o,
  now,
  hover,
  onHover,
}: {
  o: Outage;
  now: number;
  hover: boolean;
  onHover: (id: string | null) => void;
}) {
  const c = o.planned ? PLANNED : UNPLANNED;
  return (
    <li
      onPointerEnter={() => onHover(o.id)}
      onPointerLeave={() => onHover(null)}
      className={cn("flex items-start gap-3 rounded-xl px-2.5 py-2 transition-colors", hover && "bg-fg/5")}
    >
      <span aria-hidden className="mt-1.5 size-2 flex-none rounded-full" style={{ background: c }} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] leading-5 text-ink">
          {suburbsOf(o)}
          {o.affects && (
            <Pill tone="bad" size="sm">
              {o.affects === "street" ? "Your street" : "Your area"}
            </Pill>
          )}
        </span>
        <span className="text-xs leading-[18px] text-ink-muted">
          {when(o, now)}
          {o.customers ? ` · ${intAU(o.customers)} ${o.customers === 1 ? "home" : "homes"}` : ""}
        </span>
        {(o.reason || o.streets.length > 0) && (
          <span className="line-clamp-1 text-xs text-ink-faint">
            {[o.reason, o.streets.map(title).join(", ")].filter(Boolean).join(" · ")}
          </span>
        )}
      </span>
      <span className="flex-none text-xs text-ink-faint tabular-nums">
        {o.affects ? "Here" : `${o.distance_km} km ${o.direction}`}
      </span>
    </li>
  );
}

/**
 * The network's outages around the house: now (outages, and planned work under way) or planned, on a radar of the
 * radius with the house in the middle, and listed. Outages that reach the house are ringed and say so.
 */
export function OutagesCard({
  view,
  home,
  now,
}: {
  view: OutagesView;
  home: { lat: number; lon: number } | null;
  now: number;
}) {
  const [tab, setTab] = useState<"now" | "planned">(() =>
    view.now.length || !view.planned.some((o) => o.affects) ? "now" : "planned",
  );
  const [hover, setHover] = useState<string | null>(null);
  const save = useSaveSettings();
  // The radius just chosen, until the page has the outages for it.
  const radius = save.isPending ? (save.variables?.outage_radius_km ?? view.radius_km) : view.radius_km;
  const list = tab === "now" ? view.now : view.planned;
  const net = view.network;
  const s = view.summary;
  const underway = view.now.filter((o) => o.planned).length;
  // Nothing's come from the network's map yet (it can refuse the dashboard): nothing to show, rather than "no
  // outages". Settings → Integrations → Grid says why. Once something has come, it's shown as it last was.
  if (net && view.fetched_at == null) return null;
  const sub = !net
    ? ""
    : [
        s.outages
          ? `${s.outages} ${s.outages === 1 ? "outage" : "outages"} within ${view.radius_km} km, ${intAU(s.customers)} ${s.customers === 1 ? "home" : "homes"} without power`
          : `No outages within ${view.radius_km} km`,
        underway ? `${underway} planned ${underway === 1 ? "job" : "jobs"} under way` : null,
        `from ${net.name}`,
      ]
        .filter(Boolean)
        .join(" · ");
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TitleBlock title="Outages near you" sub={sub} />
        {net && (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="How far around"
              value={String(radius)}
              onChange={(e) => save.mutate({ outage_radius_km: +e.target.value })}
              className="h-9 rounded-full px-3 text-[13px]"
            >
              {[...new Set([...RADII, view.radius_km])]
                .sort((a, b) => a - b)
                .map((r) => (
                  <option key={r} value={r}>
                    Within {r} km
                  </option>
                ))}
            </Select>
            <Segmented
              label="Which outages"
              options={[
                { value: "now", label: `Now${view.now.length ? ` ${view.now.length}` : ""}` },
                { value: "planned", label: `Planned${view.planned.length ? ` ${view.planned.length}` : ""}` },
              ]}
              value={tab}
              onChange={setTab}
            />
          </div>
        )}
      </div>
      {net ? (
        <div className="flex items-start gap-6 max-md:flex-col max-md:items-center">
          {home && <Radar list={list} radius={view.radius_km} home={home} hover={hover} onHover={setHover} />}
          <div className="flex min-w-0 flex-1 flex-col gap-2 self-stretch">
            {list.length ? (
              <ul className="-mx-2.5 grid max-h-[280px] grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] content-start gap-x-4 overflow-y-auto">
                {list.map((o) => (
                  <Row key={o.id} o={o} now={now} hover={hover === o.id} onHover={setHover} />
                ))}
              </ul>
            ) : (
              <div className="py-6 text-[13px] text-ink-faint">
                {tab === "now"
                  ? `No outages within ${view.radius_km} km right now.`
                  : `No planned work within ${view.radius_km} km in the next two weeks.`}
              </div>
            )}
            <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-faint">
              <span className="flex items-center gap-1.5">
                <i className="size-2 rounded-full" style={{ background: UNPLANNED }} />
                Outage
              </span>
              <span className="flex items-center gap-1.5">
                <i className="size-2 rounded-full" style={{ background: PLANNED }} />
                Planned
              </span>
              <span>
                {view.street ? (
                  <>
                    Matching {title(view.street)}
                    {view.suburb ? `, ${title(view.suburb)}` : ""} ·{" "}
                  </>
                ) : null}
                <Link to="/settings/integrations/grid" className="text-brand no-underline hover:underline">
                  {view.street ? "Change" : "Add your street to see what reaches you"}
                </Link>
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-[13px] text-ink-muted">
          {view.supported ? (
            <>
              Outages aren't being followed.{" "}
              <Link to="/settings/integrations/grid" className="text-brand no-underline hover:underline">
                Choose your network
              </Link>
            </>
          ) : (
            "Outages come from your electricity network. Only Queensland's (Energex and Ergon Energy) are supported so far."
          )}
        </div>
      )}
    </Card>
  );
}
