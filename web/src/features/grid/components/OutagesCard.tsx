import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { sameDay } from "~/features/common/time/utils";
import { intAU } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { buttonClass } from "~/features/common/ui/components/Button";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Select } from "~/features/common/ui/components/Field";
import { LocationPrompt } from "~/features/common/settings/components/LocationPrompt";
import { useSaveSettings } from "~/features/common/settings/hooks";
import { Icon } from "~/features/common/ui/components/Icon";
import { Pill } from "~/features/common/ui/components/Pill";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { cn } from "~/features/common/ui/utils";
import type { Outage, OutagesView } from "~/features/grid/types";
import { listed } from "~/features/grid/utils";

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

/** A time as "4:48 am" today, or "Fri 10 Oct, 4:48 am" another day. */
const at = (t: number, now: number) =>
  sameDay(t, now) ? hhmm(t) : `${shortDay.format(new Date(t * 1000))}, ${hhmm(t)}`;

const homes = (n: number) => `${intAU(n)} ${n === 1 ? "home" : "homes"}`;

/** Enter or space on something that isn't a button does what a click does. */
const pressed = (e: KeyboardEvent, then: () => void) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    then();
  }
};

/**
 * Where each outage sits around the house: the house in the middle, rings at thirds of the radius, and the area each
 * outage has off where its network draws one. Pointing at one says what it is, and fades the rest back; choosing one
 * opens its details. One that reaches the house ripples.
 */
function Radar({
  list,
  radius,
  home,
  now,
  hover,
  selected,
  onHover,
  onSelect,
}: {
  list: Outage[];
  radius: number;
  home: { lat: number; lon: number };
  now: number;
  hover: string | null;
  selected: string | null;
  onHover: (id: string | null, from: "radar") => void;
  onSelect: (id: string) => void;
}) {
  const R = 100;
  const clip = useId();
  const kmPerLat = 111.32;
  const kmPerLon = 111.32 * Math.cos((home.lat * Math.PI) / 180);
  const project = (lon: number, lat: number) => ({
    x: ((lon - home.lon) * kmPerLon * R) / radius,
    y: (-(lat - home.lat) * kmPerLat * R) / radius,
  });
  const place = (o: Outage) => {
    const p = project(o.lon, o.lat);
    const d = Math.hypot(p.x, p.y);
    const k = d > R ? R / d : 1; // the ones reaching the house from further away sit on the edge
    return { x: p.x * k, y: p.y * k };
  };
  const size = (o: Outage) => 3 + Math.min(6, Math.sqrt(o.customers ?? 1) / 3);
  // What's pointed at, else what's open: the one standing out.
  const focus = hover ?? selected;
  const shown = hover && hover !== selected ? list.find((o) => o.id === hover) : undefined;
  const tip = shown ? place(shown) : null;
  // Planned work first, so an outage in the same place is drawn over it.
  const ordered = [...list].sort((a, b) => Number(!a.planned) - Number(!b.planned));
  return (
    <div className="relative w-full max-w-[260px] flex-none">
      <svg
        viewBox="-112 -112 224 224"
        className="aspect-square w-full"
        role="group"
        aria-label="Outages around your house"
      >
        <defs>
          <clipPath id={clip}>
            <circle r={R} />
          </clipPath>
        </defs>
        <circle r={R} style={{ fill: alpha(COLOR.fg, 0.025) }} />
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
        {/* The areas off, under the dots, cut to the radar. */}
        <g clipPath={`url(#${clip})`}>
          {ordered.map((o) => {
            const c = o.planned ? PLANNED : UNPLANNED;
            const on = focus === o.id;
            return o.area.map((ring, i) => (
              <polygon
                key={`${o.id}:${i}`}
                points={ring
                  .map(([lon, lat]) => {
                    const p = project(lon, lat);
                    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
                  })
                  .join(" ")}
                className={cn("transition-opacity duration-200", focus && !on && "opacity-30")}
                style={{ fill: alpha(c, on ? 0.3 : 0.14), stroke: alpha(c, on ? 0.9 : 0.45) }}
                strokeWidth="0.75"
                strokeLinejoin="round"
              />
            ));
          })}
        </g>
        {ordered.map((o) => {
          const p = place(o);
          const c = o.planned ? PLANNED : UNPLANNED;
          const on = focus === o.id;
          return (
            <g
              key={o.id}
              role="button"
              tabIndex={0}
              aria-label={`${suburbsOf(o)}, ${when(o, now)}`}
              aria-pressed={selected === o.id}
              onPointerEnter={() => onHover(o.id, "radar")}
              onPointerLeave={() => onHover(null, "radar")}
              onFocus={() => onHover(o.id, "radar")}
              onBlur={() => onHover(null, "radar")}
              onClick={() => onSelect(o.id)}
              onKeyDown={(e) => pressed(e, () => onSelect(o.id))}
              className={cn(
                "cursor-pointer transition-opacity duration-200 outline-none",
                focus && !on && "opacity-35",
              )}
            >
              {o.affects && (
                <>
                  <circle cx={p.x} cy={p.y} r={size(o) + 4} className="radar-ripple" style={{ fill: alpha(c, 0.35) }} />
                  <circle cx={p.x} cy={p.y} r={size(o) + 4} fill="none" style={{ stroke: c }} strokeWidth="1.5" />
                </>
              )}
              {/* A wider target than the dot, so a small one is easy to point at. */}
              <circle cx={p.x} cy={p.y} r={Math.max(9, size(o) + 4)} fill="transparent" />
              {selected === o.id && (
                <circle cx={p.x} cy={p.y} r={size(o) + 5} fill="none" style={{ stroke: c }} strokeWidth="1.25" />
              )}
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
      {shown && tip && (
        <div
          className="pointer-events-none absolute z-2 flex w-[200px] animate-pop flex-col gap-1 rounded-xl border border-line bg-popover px-3.5 py-3 text-[12.5px] leading-[18px] shadow-pop"
          style={{
            top: `${((tip.y + 112) / 224) * 100}%`,
            ...(tip.x > 0
              ? { right: `${((112 - tip.x) / 224) * 100}%`, marginRight: 14 }
              : { left: `${((tip.x + 112) / 224) * 100}%`, marginLeft: 14 }),
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
            {shown.customers ? ` · ${homes(shown.customers)}` : ""}
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
  onSelect,
}: {
  o: Outage;
  now: number;
  hover: boolean;
  onHover: (id: string | null, from: "row") => void;
  onSelect: (id: string) => void;
}) {
  const c = o.planned ? PLANNED : UNPLANNED;
  return (
    <li data-outage={o.id}>
      <button
        type="button"
        onClick={() => onSelect(o.id)}
        onPointerEnter={() => onHover(o.id, "row")}
        onPointerLeave={() => onHover(null, "row")}
        onFocus={() => onHover(o.id, "row")}
        onBlur={() => onHover(null, "row")}
        className={cn(
          "group flex w-full cursor-pointer items-start gap-3 rounded-xl px-2.5 py-2 text-left transition-colors",
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
            {o.customers ? ` · ${homes(o.customers)}` : ""}
          </span>
          {(o.reason || o.streets.length > 0) && (
            <span className="line-clamp-1 text-xs text-ink-faint">
              {[o.reason, o.streets.map(title).join(", ")].filter(Boolean).join(" · ")}
            </span>
          )}
        </span>
        <span className="flex flex-none items-center gap-1 text-xs text-ink-faint tabular-nums">
          {o.affects ? "Here" : `${o.distance_km} km ${o.direction}`}
          <Icon
            name="chevR"
            size={14}
            className={cn("-mr-1 transition-[transform,color] group-hover:translate-x-0.5", hover && "text-ink")}
          />
        </span>
      </button>
    </li>
  );
}

/** A fact in an outage's details: what it is, small, over the network's words. */
function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", wide && "col-span-full")}>
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="text-[13px] leading-5 text-pretty text-ink">{children}</dd>
    </div>
  );
}

/**
 * One outage in full, in place of the list: where, when, how many homes, why, and every street and suburb it lists,
 * with a way through to it on the network's own site (the outage's own page where the network has one, else its map).
 */
function OutageDetail({ o, now, network, onBack }: { o: Outage; now: number; network: string; onBack: () => void }) {
  const c = o.planned ? PLANNED : UNPLANNED;
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => back.current?.focus({ preventScroll: true }), [o.id]);
  const started = o.start != null && o.start <= now;
  const suburbs = o.suburbs.map(title);
  return (
    <div className="flex animate-pop flex-col gap-4" aria-live="polite">
      <button
        ref={back}
        type="button"
        onClick={onBack}
        className={cn(buttonClass("muted-link", "sm"), "-ml-1 gap-1 self-start rounded-full px-1 outline-offset-2")}
      >
        <Icon name="chevL" size={15} />
        All outages
      </button>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <i aria-hidden className="size-2.5 flex-none rounded-full" style={{ background: c }} />
          <h3 className="text-[17px] leading-6 font-medium text-ink">
            {suburbs.length ? suburbs.slice(0, 3).join(", ") : "Area not given"}
            {suburbs.length > 3 && <span className="text-ink-muted"> +{suburbs.length - 3}</span>}
          </h3>
          <Pill size="sm" style={{ background: alpha(c, 0.14), color: c }}>
            {o.planned ? (started ? "Planned, under way" : "Planned") : "Outage"}
          </Pill>
          {o.affects && (
            <Pill tone="bad" size="sm">
              {o.affects === "street" ? "Your street" : "Your area"}
            </Pill>
          )}
        </div>
        <div className="pl-5 text-[13px] text-ink-muted">{when(o, now)}</div>
      </div>
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-5 gap-y-3 rounded-2xl bg-fg/4 px-4 py-3.5">
        {o.start != null && <Fact label={started ? "Started" : "Starts"}>{at(o.start, now)}</Fact>}
        <Fact label={o.planned ? "Ends" : "Power back"}>
          {o.end != null
            ? `${o.planned ? "" : "By "}${at(o.end, now)}`
            : o.end_text
              ? title(o.end_text)
              : "Not known yet"}
        </Fact>
        <Fact label="Homes without power">{o.customers != null ? intAU(o.customers) : "Not given"}</Fact>
        <Fact label="From your house">
          {o.affects
            ? o.affects === "street"
              ? "On your street"
              : "Covers your house"
            : `${o.distance_km} km ${o.direction}`}
        </Fact>
        {o.reason && <Fact label="Cause">{o.reason}</Fact>}
        {o.status && <Fact label="Status">{title(o.status)}</Fact>}
        {o.streets.length > 0 && (
          <Fact label={o.streets.length === 1 ? "Street" : `Streets (${o.streets.length})`} wide>
            <span className="line-clamp-4">{o.streets.map(title).join(", ")}</span>
          </Fact>
        )}
        {suburbs.length > 3 && (
          <Fact label={`Suburbs (${suburbs.length})`} wide>
            {suburbs.join(", ")}
          </Fact>
        )}
      </dl>
      {o.url && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <a href={o.url} target="_blank" rel="noreferrer" className={buttonClass("outline", "sm", "gap-1.5")}>
            {o.url_exact ? `See it on ${network}'s site` : `${network}'s outage map`}
            <Icon name="external" size={14} />
          </a>
          {!o.url_exact && (
            <span className="text-xs text-ink-faint">
              {network} can't link to one outage: look for {suburbs[0] ?? "it"} there.
            </span>
          )}
        </div>
      )}
    </div>
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
  // The outage whose details are open, in place of the list.
  const [chosen, setChosen] = useState<string | null>(null);
  const rows = useRef<HTMLUListElement>(null);
  const side = useRef<HTMLDivElement>(null);
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
  // Gone from the list (power's back, or the radius or tab changed): back to the list.
  const open = list.find((o) => o.id === chosen) ?? null;
  const select = (id: string) => {
    setChosen(id === chosen ? null : id);
    setHover(null);
    // On a phone the details are under the radar: bring them up.
    requestAnimationFrame(() => {
      const el = side.current;
      if (el && el.getBoundingClientRect().top > window.innerHeight - 120)
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };
  const close = () => {
    const id = chosen;
    setChosen(null);
    // Back on the row it was opened from.
    requestAnimationFrame(() =>
      rows.current?.querySelector<HTMLElement>(`[data-outage="${CSS.escape(id ?? "")}"] button`)?.focus(),
    );
  };
  const names = Object.fromEntries(view.networks.map((n) => [n.id, n.name]));
  // Where it can't be told which network serves the house, each that might is followed.
  const sources = listed(view.networks.map((n) => n.name)) || net?.name;
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
        `from ${sources}`,
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
              onChange={(t) => {
                setTab(t);
                setChosen(null);
              }}
            />
          </div>
        )}
      </div>
      {net ? (
        <div className="flex items-start gap-6 max-md:flex-col max-md:items-center">
          {home && (
            <Radar
              list={list}
              radius={radius}
              home={home}
              now={now}
              hover={hover?.id ?? null}
              selected={open?.id ?? null}
              onHover={onHover}
              onSelect={select}
            />
          )}
          <div
            ref={side}
            className="flex min-w-0 flex-1 scroll-mt-4 flex-col gap-2 self-stretch"
            onKeyDown={(e) => {
              if (e.key === "Escape" && open) close();
            }}
          >
            {open ? (
              <OutageDetail o={open} now={now} network={names[open.network] ?? net.name} onBack={close} />
            ) : list.length ? (
              <ul
                ref={rows}
                className="relative -mx-2.5 grid max-h-[280px] grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] content-start gap-x-4 overflow-y-auto"
              >
                {list.map((o) => (
                  <Row key={o.id} o={o} now={now} hover={hover?.id === o.id} onHover={onHover} onSelect={select} />
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
                  {view.error
                    ? `Couldn't reach ${view.networks.length > 1 ? "every network" : net.name} · last checked `
                    : `Checked ${sources} `}
                  {ago(checked, now)}
                </span>
              )}
            </div>
          </div>
        </div>
      ) : !view.location_set ? (
        <LocationPrompt>Outages are found around your house, so they need to know where it is.</LocationPrompt>
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
            "Outages come from your electricity network. The Northern Territory's isn't supported yet."
          )}
        </div>
      )}
    </Card>
  );
}
