import { COLS, firstFit } from "~/features/dashboards/utils/layout";
import type { Dashboard, WidgetItem } from "~/features/dashboards/types";
import { defaultSettings, sizesOf, widgetDef } from "~/features/dashboards/widgets/registry";
import type { Settings, WidgetCtx } from "~/features/common/widgets/types";

type Spec = [type: string, w: number, h: number, settings?: Settings];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Widgets in order, each in the first space it fits on the computer's grid (top to bottom, then left to right),
 * leaving out any that can't be shown here, and kept within the sizes each allows. Their ids are fixed by their place
 * in the list, so the default (worked out afresh on each render until it's saved) keeps its widgets as they are.
 */
function lay(specs: Spec[], ctx: WidgetCtx): WidgetItem[] {
  const items: WidgetItem[] = [];
  specs.forEach(([type, sw, sh, extra], n) => {
    const def = widgetDef(type);
    if (!def || def.needs?.(ctx)) return;
    const settings = { ...defaultSettings(def, ctx), ...extra };
    const lim = sizesOf(def, settings, "computer", sw);
    const w = clamp(sw, lim.min[0], Math.min(lim.max[0], COLS.computer));
    const h = clamp(sh, lim.min[1], lim.max[1]);
    items.push({ id: `${type}-${n}`, type, ...firstFit(items, w, h, COLS.computer), w, h, settings });
  });
  return items;
}

export type Preset = { id: string; name: string; sub: string; specs: (ctx: WidgetCtx) => Spec[] };

export const PRESETS: Preset[] = [
  {
    id: "now",
    name: "Now",
    sub: "The power flow, each part's day so far, what today costs and what's ahead",
    specs: (ctx) => [
      ["power-flow", 12, 6, { style: "scene" }],
      ["solar-summary", 12, 3],
      ["home-summary", 12, 3],
      ["battery-summary", 12, 3],
      ["grid-summary", 12, 3],
      ["car", 12, 4],
      ["today-costs", 7, 7],
      ["solar-ahead", 5, 4],
      // with no battery, where the home's power came from in its place
      ctx.noBattery ? ["home-sources", 5, 3] : ["battery-backup", 5, 3],
      ["amber-prices", 12, 5],
      ["rooms-now", 12, 5],
    ],
  },
  {
    id: "classic",
    name: "Classic",
    sub: "The power flow, the battery, today's costs and energy, as the Overview first was",
    specs: (ctx) => [
      ["power-flow", 12, 6, { style: "scene" }],
      ["grid", 12, 1],
      ...(ctx.noBattery
        ? ([["today-costs", 12, 7]] as Spec[])
        : ([
            ["battery", 6, 7],
            ["today-costs", 6, 7],
          ] as Spec[])),
      ["running-now", 12, 2],
      ["today-energy", 12, 8],
      ["amber-prices", 12, 5],
    ],
  },
  {
    id: "glance",
    name: "Compact",
    sub: "The figures that matter most, small and side by side",
    specs: (ctx) => [
      ["power-flow", 6, 4, { style: "bars" }],
      ["figure", 3, 2, ctx.noBattery ? { metric: "solar" } : { metric: "battery" }],
      ["figure", 3, 2, { metric: "price", spark: false }],
      ["figure", 3, 2, { metric: "self-today", spark: false }],
      ["figure", 3, 2, { metric: "cost-today", spark: false }],
      ["weather", 4, 4],
      ["solar-ahead", 4, 4],
      ["home-sources", 4, 4],
      ["running-now", 12, 2],
      ["grid", 12, 1],
    ],
  },
  {
    id: "money",
    name: "Money",
    sub: "What it costs, what it saves, and the prices ahead",
    specs: () => [
      ["figure", 4, 2, { metric: "cost-today", spark: false }],
      ["figure", 4, 2, { metric: "saved-today", spark: false }],
      ["figure", 4, 2, { metric: "price", spark: false }],
      ["today-costs", 6, 7],
      ["grid-wholesale", 6, 7],
      ["amber-prices", 12, 5],
      ["home-goals", 12, 3],
    ],
  },
  {
    id: "solar",
    name: "Solar",
    sub: "The panels today and the days ahead",
    specs: () => [
      ["solar-today", 12, 8],
      ["solar-days", 7, 4],
      ["solar-where", 5, 4],
      ["solar-strings", 5, 5],
      ["solar-ahead", 7, 5],
      ["solar-performance", 7, 5],
      ["solar-trend", 5, 5],
    ],
  },
];

export const presetLayout = (preset: Preset, ctx: WidgetCtx) => lay(preset.specs(ctx), ctx);

export const preset = (id: string) => PRESETS.find((p) => p.id === id) ?? PRESETS[0];

/** The dashboards before any are saved: one, Now, with what's connected here. */
export const defaultDashboards = (ctx: WidgetCtx): Dashboard[] => [
  { id: "now", name: "Now", layouts: { computer: presetLayout(preset("now"), ctx), phone: null } },
];
