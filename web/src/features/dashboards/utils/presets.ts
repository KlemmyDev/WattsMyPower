import { COLS, firstFit, newId } from "~/features/dashboards/utils/layout";
import type { Dashboard, WidgetItem } from "~/features/dashboards/types";
import { defaultSettings, widgetDef } from "~/features/dashboards/widgets/registry";
import type { Settings, WidgetCtx } from "~/features/common/widgets/types";

type Spec = [type: string, w: number, h: number, settings?: Settings];

/** Widgets in order, each in the first space it fits on the computer's grid (top to bottom, then left to right),
 * leaving out any that can't be shown here. */
function lay(specs: Spec[], ctx: WidgetCtx): WidgetItem[] {
  const items: WidgetItem[] = [];
  for (const [type, w, h, settings] of specs) {
    const def = widgetDef(type);
    if (!def || def.needs?.(ctx)) continue;
    items.push({
      id: newId(),
      type,
      ...firstFit(items, w, h, COLS.computer),
      w,
      h,
      settings: { ...defaultSettings(def, ctx), ...settings },
    });
  }
  return items;
}

export type Preset = { id: string; name: string; sub: string; specs: (ctx: WidgetCtx) => Spec[] };

export const PRESETS: Preset[] = [
  {
    id: "everything",
    name: "Everything",
    sub: "The Overview as it's always been",
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
    name: "At a glance",
    sub: "The figures that matter most, small",
    specs: () => [
      ["power-flow", 6, 5, { style: "bars" }],
      ["figure", 3, 2, { metric: "battery" }],
      ["figure", 3, 2, { metric: "price", spark: false }],
      ["figure", 3, 2, { metric: "self-today", spark: false }],
      ["figure", 3, 2, { metric: "cost-today", spark: false }],
      ["running-now", 6, 2],
      ["weather", 3, 2],
      ["figure", 3, 2, { metric: "solar-today", spark: false }],
      ["solar-ahead", 6, 4],
      ["home-sources", 6, 3],
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

/** The dashboards before any are saved: one, the Overview as it's always been. */
export const defaultDashboards = (ctx: WidgetCtx): Dashboard[] => [
  { id: "now", name: "Now", layouts: { computer: presetLayout(PRESETS[0], ctx), phone: null } },
];
