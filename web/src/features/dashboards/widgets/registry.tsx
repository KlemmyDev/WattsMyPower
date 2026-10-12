import { capRows } from "~/features/common/widgets/room";
import type { GroupId, Screen, Settings, Sizes, WidgetCtx, WidgetDef } from "~/features/common/widgets/types";

/**
 * Every widget there is: each feature's own, from its catalogue (`features/<feature>/widgets/index.tsx`, exporting
 * `widgets`), found when the app is built, so a feature that catalogues a card offers it here with nothing else to do.
 */
const catalogues = import.meta.glob<{ widgets?: WidgetDef[] }>("../../*/widgets/index.tsx", { eager: true });

/** The sections the list of widgets shows them under, in the navigation's order. */
export const GROUPS: { id: GroupId; name: string }[] = [
  { id: "general", name: "Any reading" },
  { id: "overview", name: "Overview" },
  { id: "solar", name: "Solar" },
  { id: "home", name: "Home" },
  { id: "battery", name: "Battery" },
  { id: "grid", name: "Grid" },
  { id: "car", name: "EV" },
  { id: "money", name: "Money" },
  { id: "weather", name: "Weather" },
];

const rank = new Map(GROUPS.map((g, i) => [g.id, i]));

export const WIDGETS: WidgetDef[] = Object.keys(catalogues)
  .sort()
  .flatMap((path) => catalogues[path].widgets ?? [])
  .sort((a, b) => (rank.get(a.group) ?? 99) - (rank.get(b.group) ?? 99));

if (import.meta.env.DEV) {
  const seen = new Set<string>();
  for (const w of WIDGETS) {
    if (seen.has(w.type)) console.warn(`Two widgets are catalogued as "${w.type}": types must be unique.`);
    seen.add(w.type);
  }
}

export const widgetDef = (type: string) => WIDGETS.find((w) => w.type === type);

/** A widget's sizes on a screen, for its settings (and at `w` columns, else its usual width). */
export function sizesOf(def: WidgetDef, settings: Settings, screen: Screen, w?: number): Sizes {
  const base =
    def.sizesFor?.(settings, screen) ??
    (screen === "phone"
      ? (def.phone ?? {
          min: [2, def.sizes.min[1]],
          max: [4, def.sizes.max[1]],
          default: [def.sizes.default[0] <= 3 ? 2 : 4, def.sizes.default[1]],
        })
      : def.sizes);
  const rows = def.rowsFor?.(settings, screen, w ?? base.default[0]);
  return rows == null ? base : capRows(base, rows);
}

/** Why a widget's left out here (it needs something that isn't connected), once that's known; else null. */
export const missing = (def: WidgetDef, ctx: WidgetCtx) => (ctx.known ? (def.needs?.(ctx) ?? null) : null);

/** A new widget's settings: each option's default. */
export function defaultSettings(def: WidgetDef, ctx: WidgetCtx): Settings {
  const out: Settings = {};
  for (const o of def.options ?? []) out[o.key] = typeof o.default === "function" ? o.default(ctx) : o.default;
  return out;
}

/** The sizes the settings name: its smallest, its usual, a larger one, and the whole width (where it goes so wide). */
export function namedSizes(sizes: Sizes, cols: number): { label: string; w: number; h: number }[] {
  const out: { label: string; w: number; h: number }[] = [];
  const add = (label: string, w: number, h: number) => {
    w = Math.min(w, cols);
    if (!out.some((s) => s.w === w && s.h === h)) out.push({ label, w, h });
  };
  add("Small", sizes.min[0], sizes.min[1]);
  add("Medium", sizes.default[0], sizes.default[1]);
  add(
    "Large",
    Math.max(sizes.default[0], Math.min(sizes.max[0], Math.round((sizes.default[0] + sizes.max[0]) / 2))),
    Math.min(sizes.max[1], sizes.default[1] + 1),
  );
  if (sizes.max[0] >= cols) add("Full width", cols, sizes.default[1]);
  return out;
}
