import { useState } from "react";
import { Icon } from "~/features/common/ui/components/Icon";
import { Switch } from "~/features/common/ui/components/Switch";
import { cn } from "~/features/common/ui/utils";
import { Thumb } from "~/features/common/widgets/Thumb";
import type { GroupId, Settings, WidgetCtx, WidgetDef, WidgetOption } from "~/features/common/widgets/types";
import type { Screen, WidgetItem } from "~/features/dashboards/types";
import { COLS } from "~/features/dashboards/utils/layout";
import { GROUPS, namedSizes, sizesOf, WIDGETS, widgetDef } from "~/features/dashboards/widgets/registry";

/** Widgets most worth suggesting, in order, when what they need is connected and they aren't on the page yet. */
const SUGGESTED = [
  "car",
  "rooms-now",
  "amber-prices",
  "solar-summary",
  "battery-summary",
  "home-summary",
  "weather",
  "figure",
];

/** A section's label in the list, quiet, in capitals. */
const Label = ({ children }: { children: string }) => (
  <span className="pt-2 text-[11px] font-medium tracking-[1px] text-ink-faint uppercase">{children}</span>
);

/** One widget to add: its picture, what it is, the sizes it comes in (or that it's on the page), and the button. */
function Row({ def, why, placed, onAdd }: { def: WidgetDef; why: string | null; placed: boolean; onAdd: () => void }) {
  const sizes = namedSizes(def.sizes, COLS.computer).map((s) => s.label[0]);
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-line-subtle bg-surface p-2.5 transition-colors",
        why ? "opacity-55" : "hover:border-line",
      )}
    >
      <Thumb thumb={def.thumb} className="h-[58px] w-[84px]" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <b className="truncate text-[13px] font-semibold">{def.name}</b>
        <span className="line-clamp-2 text-[11px] leading-[15px] text-ink-muted">{why ?? def.sub}</span>
        <span className="font-mono text-[10px] text-ink-faint">
          {placed ? <span className="text-brand">On this page</span> : sizes.join(" · ")}
        </span>
      </span>
      <button
        type="button"
        disabled={!!why}
        aria-label={`Add ${def.name}`}
        onClick={onAdd}
        className={cn(
          "flex size-[30px] flex-none cursor-pointer items-center justify-center rounded-full border-0 p-0 transition-transform hover:scale-105 disabled:cursor-default disabled:bg-fg/10 disabled:text-ink-faint disabled:hover:scale-100",
          placed ? "bg-fg/12 text-ink-sub" : "bg-ink text-ink-inverse",
        )}
      >
        <Icon name="plus" size={14} />
      </button>
    </li>
  );
}

/** Every widget there is to add, a few suggested for this home, then by section, with a search. */
export function AddWidgets({
  ctx,
  onAdd,
  placed,
  bare = false,
}: {
  ctx: WidgetCtx;
  onAdd: (type: string) => void;
  /** The widgets already on the page. */
  placed: Set<string>;
  /** In a sheet with its own title: no heading of its own. */
  bare?: boolean;
}) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<GroupId | "all">("all");
  const words = q.trim().toLowerCase();
  const shown = WIDGETS.filter(
    (w) => (group === "all" || w.group === group) && (!words || `${w.name} ${w.sub}`.toLowerCase().includes(words)),
  );
  const suggested =
    group === "all" && !words
      ? SUGGESTED.map(widgetDef)
          .filter((w): w is WidgetDef => !!w && !w.needs?.(ctx) && !placed.has(w.type))
          .slice(0, 3)
      : [];
  const groups = GROUPS.filter((g) => shown.some((w) => w.group === g.id));
  const chip = (on: boolean) =>
    cn(
      "h-[30px] cursor-pointer rounded-full border px-3 font-sans text-xs font-medium whitespace-nowrap transition-colors",
      on ? "border-ink bg-ink text-ink-inverse" : "border-line bg-transparent text-ink-sub hover:text-ink",
    );
  const row = (w: WidgetDef) => (
    <Row key={w.type} def={w} why={w.needs?.(ctx) ?? null} placed={placed.has(w.type)} onAdd={() => onAdd(w.type)} />
  );
  return (
    <div className="flex flex-col gap-4">
      {!bare && (
        <div className="flex flex-col gap-1">
          <h2 className="m-0 font-display text-xl font-bold">Add widgets</h2>
          <span className="text-xs text-ink-sub">
            {WIDGETS.length} to choose from. Each goes in the first space it fits; drag it from there.
          </span>
        </div>
      )}
      <label className="flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-ink-sub focus-within:border-line-strong">
        <Icon name="search" size={15} />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search widgets"
          aria-label="Search widgets"
          className="min-w-0 flex-1 border-0 bg-transparent font-sans text-[13px] text-ink outline-none placeholder:text-ink-sub"
        />
      </label>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={chip(group === "all")} onClick={() => setGroup("all")}>
          All
        </button>
        {GROUPS.filter((g) => WIDGETS.some((w) => w.group === g.id)).map((g) => (
          <button key={g.id} type="button" className={chip(group === g.id)} onClick={() => setGroup(g.id)}>
            {g.name}
          </button>
        ))}
      </div>
      {suggested.length > 0 && (
        <>
          <Label>Suggested for your home</Label>
          <ul className="m-0 -mt-2 flex list-none flex-col gap-2 p-0">{suggested.map(row)}</ul>
        </>
      )}
      {groups.map((g) => (
        <div key={g.id} className="flex flex-col gap-2">
          {group === "all" && <Label>{g.name}</Label>}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">{shown.filter((w) => w.group === g.id).map(row)}</ul>
        </div>
      ))}
      {!shown.length && <div className="py-6 text-center text-[13px] text-ink-faint">No widget matches that.</div>}
    </div>
  );
}

/** − n + for a widget's exact width or height, within what it allows. */
function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const btn =
    "flex size-7 cursor-pointer items-center justify-center rounded-full border border-line bg-transparent p-0 text-ink transition-colors hover:bg-fg/8 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent";
  return (
    <div className="flex flex-1 items-center justify-between gap-2">
      <span className="text-xs text-ink-sub">{label}</span>
      <span className="flex items-center gap-1.5">
        <button
          type="button"
          className={btn}
          disabled={value <= min}
          aria-label={`Fewer ${label.toLowerCase()}`}
          onClick={() => onChange(value - 1)}
        >
          <Icon name="minus" size={12} />
        </button>
        <span className="w-5 text-center font-mono text-xs tabular-nums">{value}</span>
        <button
          type="button"
          className={btn}
          disabled={value >= max}
          aria-label={`More ${label.toLowerCase()}`}
          onClick={() => onChange(value + 1)}
        >
          <Icon name="plus" size={12} />
        </button>
      </span>
    </div>
  );
}

const SECTION = "flex flex-col gap-2.5";
const HEAD = "text-xs text-ink-sub";
const LIST =
  "flex flex-col rounded-2xl border border-line-subtle bg-surface [&>*+*]:border-t [&>*+*]:border-line-subtle";

/** A widget's own settings: its style (each drawn), its size, what it shows; and taking it off the dashboard. */
export function WidgetSettings({
  item,
  ctx,
  screen,
  onChange,
  onRemove,
  onDone,
  bare = false,
}: {
  item: WidgetItem;
  ctx: WidgetCtx;
  screen: Screen;
  onChange: (change: { settings?: Settings; w?: number; h?: number }) => void;
  onRemove: () => void;
  onDone?: () => void;
  /** In a sheet with its own title: no heading of its own. */
  bare?: boolean;
}) {
  const def = widgetDef(item.type);
  if (!def) return null;
  const cols = COLS[screen];
  const sizes = sizesOf(def, item.settings, screen);
  const named = namedSizes(sizes, cols);
  const set = (key: string, value: unknown) => onChange({ settings: { ...item.settings, [key]: value } });
  const style = def.options?.find((o) => o.kind === "style");
  const listed = (def.options ?? []).flatMap((o) =>
    o.kind !== "style" && (!o.when || o.when(item.settings)) && (!o.offered || o.offered(ctx)) ? [o] : [],
  );
  // Switches and choices under their headings, in the order they're first met ("Readings", "Also show", "Figures").
  const sections: [string, typeof listed][] = [];
  for (const o of listed) {
    const title = o.section || (o.kind === "toggle" ? "Show" : style ? "Readings" : "Shows");
    const at = sections.find(([t]) => t === title);
    if (at) at[1].push(o);
    else sections.push([title, [o]]);
  }
  return (
    <div className="flex flex-col gap-6">
      {!bare && (
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="m-0 font-display text-[22px] font-bold">{def.name}</h2>
            <span className="text-[13px] text-ink-sub">{def.sub}</span>
          </div>
          {onDone && (
            <button
              type="button"
              onClick={onDone}
              className="h-9 flex-none cursor-pointer rounded-full border-0 bg-ink px-4 font-sans text-[13px] font-semibold text-ink-inverse"
            >
              Done
            </button>
          )}
        </div>
      )}

      {style?.kind === "style" && (
        <div className={SECTION}>
          <span className={HEAD}>{style.label}</span>
          <div className="grid grid-cols-3 gap-2">
            {style.choices.map((c) => {
              const on = (item.settings[style.key] ?? style.default) === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set(style.key, c.value)}
                  className={cn(
                    "flex h-[84px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[14px] border p-1.5 font-sans text-xs font-medium text-ink transition-colors",
                    on ? "border-2 border-brand bg-brand/12" : "border-line bg-surface hover:border-line-strong",
                  )}
                >
                  {c.thumb && <Thumb thumb={c.thumb} className="h-10 w-[72px]" />}
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className={SECTION}>
        <span className={HEAD}>Size</span>
        <div
          role="group"
          aria-label="Size"
          className="flex gap-1 rounded-full border border-line-subtle bg-surface p-1"
        >
          {named.map((n) => {
            const on = item.w === n.w && item.h === n.h;
            return (
              <button
                key={n.label}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ w: n.w, h: n.h })}
                className={cn(
                  "h-[34px] flex-1 cursor-pointer rounded-full border-0 font-sans text-xs font-medium whitespace-nowrap transition-colors",
                  on ? "bg-ink text-ink-inverse" : "bg-transparent text-ink-sub hover:text-ink",
                )}
              >
                {n.label}{" "}
                <span className="font-mono text-[10px] opacity-65">
                  {n.w}×{n.h}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex gap-5 px-1">
          <Stepper
            label="Columns"
            value={item.w}
            min={Math.min(sizes.min[0], cols)}
            max={Math.min(sizes.max[0], cols)}
            onChange={(w) => onChange({ w })}
          />
          <Stepper
            label="Rows"
            value={item.h}
            min={sizes.min[1]}
            max={sizes.max[1]}
            onChange={(h) => onChange({ h })}
          />
        </div>
      </div>

      {sections.map(([title, list]) => (
        <div key={title} className={SECTION}>
          <span className={HEAD}>{title}</span>
          <div className={LIST}>
            {list.map((o) =>
              o.kind === "toggle" ? (
                <div key={o.key} className="flex items-center gap-3 px-3.5 py-3">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm">{o.label}</span>
                    {o.sub && <span className="text-xs text-ink-sub">{o.sub}</span>}
                  </span>
                  <Switch
                    on={(item.settings[o.key] ?? o.default) === true}
                    label={o.label}
                    onChange={(v) => set(o.key, v)}
                  />
                </div>
              ) : (
                <Pick key={o.key} option={o} ctx={ctx} settings={item.settings} onChange={(v) => set(o.key, v)} />
              ),
            )}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={onRemove}
        className="cursor-pointer self-start border-0 bg-transparent p-0 font-sans text-[13px] font-medium text-bad hover:underline"
      >
        Remove this widget
      </button>
    </div>
  );
}

/**
 * A choice from a list: two or three short ones side by side (a segmented control), more as a menu. A list of what's
 * there (cars, rooms) is read from the home.
 */
function Pick({
  option: o,
  ctx,
  settings,
  onChange,
}: {
  option: Extract<WidgetOption, { kind: "select" }>;
  ctx: WidgetCtx;
  settings: Settings;
  onChange: (value: string) => void;
}) {
  const choices = typeof o.choices === "function" ? o.choices(ctx) : o.choices;
  const value = String(settings[o.key] ?? (typeof o.default === "function" ? o.default(ctx) : o.default));
  const few = choices.length <= 3 && choices.every((c) => c.label.length <= 10);
  if (few)
    return (
      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
        <span className="min-w-0 truncate">{o.label}</span>
        <div role="group" aria-label={o.label} className="flex flex-none gap-0.5 rounded-full bg-fg/6 p-0.5">
          {choices.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-pressed={c.value === value}
              onClick={() => onChange(c.value)}
              className={cn(
                "h-7 cursor-pointer rounded-full border-0 px-3 font-sans text-xs font-medium whitespace-nowrap transition-colors",
                c.value === value ? "bg-ink text-ink-inverse" : "bg-transparent text-ink-sub hover:text-ink",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    );
  return (
    <label className="flex items-center justify-between gap-3 px-3.5 py-3 text-sm">
      <span className="min-w-0 truncate">{o.label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 max-w-[62%] rounded-[10px] border border-line bg-surface-raised px-2 font-sans text-[13px] text-ink"
      >
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
}
