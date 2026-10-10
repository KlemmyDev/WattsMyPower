import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { sameDay } from "~/features/common/time/utils";
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

/** The distances the radius can be set to (Manage → Integrations → Grid has the same). */
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
  const day = (t: number) => (sameDay(t, now) ? "Today" : shortDay.format(new Date(t * 1000)));
  const end = o.end ? hhmm(o.end) : o.end_text ? title(o.end_text) : "not known";
  if (!o.start) return `Back ${end}`;
  if (o.start <= now && !o.planned)
    return o.end ? `Since ${hhmm(o.start)}, back by ${end}` : `Since ${hhmm(o.start)} · ${end}`;
  return `${day(o.start)}, ${hhmm(o.start)} to ${end}`;
}

/** How long ago the network's map was read: "just now", "4 min ago", "at 2:15 pm", "Wed 8 Oct, 2:15 pm". */
function ago(at: number, now: number): string {
  const mins = Math.floor((now - at) / 60);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (sameDay(at, now)) return `at ${hhmm(at)}`;
  return `${shortDay.format(new Date(at * 1000))}, ${hhmm(at)}`;
}

/**
 * Where each outage sits around the house: the house in the middle, rings at thirds of the radius. Pointing at one
 * says what it is, and fades the rest back; one that reaches the house ripples.
 */
function Radar({
  list,
  radius,
  home,
  now,
  hover,
  onHover,
}: {
  list: Outage[];
  radius: number;
  home: { lat: number; lon: number };
  now: number;
  hover: string | null;
  onHover: (id: string | null, from: "radar") => void;
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
  const shown = hover ? list.find((o) => o.id === hover) : undefined;
  const at = shown ? place(shown) : null;
  return (
    <div className="relative w-full max-w-[240px] flex-none">
      <svg
        viewBox="-112 -112 224 224"
        className="aspect-square w-full"
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
                onPointerEnter={() => onHover(o.id, "radar")}
                onPointerLeave={() => onHover(null, "radar")}
                className={cn("cursor-pointer transition-opacity duration-200", hover && !on && "opacity-35")}
              >
                {o.affects && (
                  <>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={size(o) + 4}
                      className="radar-ripple"
                      style={{ fill: alpha(c, 0.35) }}
                    />
                    <circle cx={p.x} cy={p.y} r={size(o) + 4} fill="none" style={{ stroke: c }} strokeWidth="1.5" />
                  </>
                )}
                {/* A wider target than the dot, so a small one is easy to point at. */}
                <circle cx={p.x} cy={p.y} r={Math.max(9, size(o) + 4)} fill="transparent" />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={size(o) + (on ? 2 : 0)}
                  className="transition-[r] duration-200 ease-out-soft"
                  style={{ fill: alpha(c, on ? 1 : 0.75), stroke: "var(--color-surface)" }}
                  strokeWidth="1.5"
                />
              </g>
            );
          })}
        <circle r="5" style={{ fill: COLOR.ink, stroke: "var(--color-surface)" }} strokeWidth="2" />
      </svg>
      {shown && at && (
        <div
          className="pointer-events-none absolute z-2 flex w-[200px] animate-pop flex-col gap-1 rounded-xl border border-line bg-popover px-3.5 py-3 text-[12.5px] leading-[18px] shadow-pop"
          style={{
            top: `${((at.y + 112) / 224) * 100}%`,
            ...(at.x > 0
              ? { right: `${((112 - at.x) / 224) * 100}%`, marginRight: 14 }
              : { left: `${((at.x + 112) / 224) * 100}%`, marginLeft: 14 }),
            transform: "translateY(-50%)",
          }}
        >
          <span className="flex items-center gap-1.5 font-medium text-ink">
            <i
              aria-hidden
              className="size-2 flex-none rounded-full"
              style={{ background: shown.planned ? PLANNED : UNPLANNED }}
            />
            <span className="truncate">{suburbsOf(shown)}</span>
          </span>
          <span className="text-ink-muted">{when(shown, now)}</span>
          <span className="text-ink-faint tabular-nums">
            {shown.affects
              ? shown.affects === "street"
                ? "Your street"
                : "Your area"
              : `${shown.distance_km} km ${shown.direction}`}
            {shown.customers ? ` · ${intAU(shown.customers)} ${shown.customers === 1 ? "home" : "homes"}` : ""}
          </span>
        </div>
      )}
    </div>
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
  onHover: (id: string | null, from: "row") => void;
}) {
  const c = o.planned ? PLANNED : UNPLANNED;
  return (
    <li
      data-outage={o.id}
      onPointerEnter={() => onHover(o.id, "row")}
      onPointerLeave={() => onHover(null, "row")}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl px-2.5 py-2 transition-colors",
        hover && "bg-fg/5",
      )}
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
  const [hover, setHover] = useState<{ id: string; from: "radar" | "row" } | null>(null);
  const onHover = (id: string | null, from: "radar" | "row") => setHover(id ? { id, from } : null);
  const rows = useRef<HTMLUListElement>(null);
  // Pointing at a dot on the radar brings its row into view in the list, without moving the page.
  useEffect(() => {
    const ul = rows.current;
    if (hover?.from !== "radar" || !ul) return;
    const li = ul.querySelector<HTMLElement>(`[data-outage="${CSS.escape(hover.id)}"]`);
    if (!li) return;
    const top = li.offsetTop; // from the list's top: it's positioned
    if (top < ul.scrollTop || top + li.offsetHeight > ul.scrollTop + ul.clientHeight)
      ul.scrollTo({ top: top - ul.clientHeight / 2 + li.offsetHeight / 2, behavior: "smooth" });
  }, [hover]);
  const save = useSaveSettings();
  // The radius just chosen, until the page has the outages for it.
  const radius = save.isPending ? (save.variables?.outage_radius_km ?? view.radius_km) : view.radius_km;
  const list = tab === "now" ? view.now : view.planned;
  const net = view.network;
  const s = view.summary;
  const underway = view.now.filter((o) => o.planned).length;
  // Nothing's come from the network's map yet (it can turn the dashboard away): the card stays, with the radius,
  // but doesn't claim there are no outages when it can't know. Manage → Integrations → Grid says why.
  const waiting = !!net && view.fetched_at == null;
  // Planned work to come is read hourly, apart from the outages now.
  const checked = tab === "planned" ? (view.planned_at ?? view.fetched_at) : view.fetched_at;
  const sub = !net
    ? ""
    : [
        s.outages
          ? `${s.outages} ${s.outages === 1 ? "outage" : "outages"} within ${view.radius_km} km, ${intAU(s.customers)} ${s.customers === 1 ? "home" : "homes"} without power`
          : waiting
            ? `Outages within ${radius} km will show here`
            : `No outages within ${radius} km`,
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
          {home && (
            <Radar list={list} radius={radius} home={home} now={now} hover={hover?.id ?? null} onHover={onHover} />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-2 self-stretch">
            {list.length ? (
              <ul
                ref={rows}
                className="relative -mx-2.5 grid max-h-[280px] grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] content-start gap-x-4 overflow-y-auto"
              >
                {list.map((o) => (
                  <Row key={o.id} o={o} now={now} hover={hover?.id === o.id} onHover={onHover} />
                ))}
              </ul>
            ) : (
              <div className="py-6 text-[13px] text-ink-faint">
                {waiting
                  ? `Nothing from ${net.name}'s outage map yet. Outages and planned work within ${radius} km show here as it reports them.`
                  : tab === "now"
                    ? `No outages within ${radius} km right now.`
                    : `No planned work within ${radius} km in the next two weeks.`}
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
                <Link to="/integrations/grid" className="text-brand no-underline hover:underline">
                  {view.street ? "Change" : "Add your street to see what reaches you"}
                </Link>
              </span>
              {checked != null && (
                <span
                  className={cn("ml-auto tabular-nums", view.error && "text-warn")}
                  title={`${shortDay.format(new Date(checked * 1000))}, ${hhmm(checked)}${view.error ? ` · ${view.error}` : ""}`}
                >
                  {view.error ? `Couldn't reach ${net.name} · last checked ` : `Checked ${net.name} `}
                  {ago(checked, now)}
                </span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="text-[13px] text-ink-muted">
          {view.supported ? (
            <>
              Outages aren't being followed.{" "}
              <Link to="/integrations/grid" className="text-brand no-underline hover:underline">
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
