import type { PlanTariff } from "~/features/settings/types";
import type { IconName } from "~/features/common/ui/components/Icon";
import type { Tariff, TariffBand, TimeWindow } from "~/features/common/tariffs/types";
import { seedBands } from "~/features/common/tariffs/utils";

/** A change to the tariff being edited. Bands and windows are addressed by index. */
export type TariffEdit =
  | { type: "set-field"; field: "flat_rate" | "feed_in_rate" | "supply_charge"; value: number | "" }
  | { type: "set-rate-type"; value: Tariff["type"] }
  | { type: "set-band"; band: number; patch: Partial<Pick<TariffBand, "name" | "rate">> }
  | { type: "set-window"; band: number; window: number; patch: Partial<TimeWindow> }
  | { type: "add-band" }
  | { type: "remove-band"; band: number }
  | { type: "add-window"; band: number }
  | { type: "remove-window"; band: number; window: number }
  | { type: "make-other"; band: number };

const newWindow = (): TimeWindow => ({ days: "all", start: "07:00", end: "09:00" });

const updateBand = (t: Tariff, i: number, fn: (b: TariffBand) => TariffBand): Tariff => ({
  ...t,
  bands: t.bands.map((b, j) => (j === i ? fn(b) : b)),
});

export function applyEdit(t: Tariff, e: TariffEdit): Tariff {
  switch (e.type) {
    case "set-field":
      return { ...t, [e.field]: e.value };
    case "set-rate-type": {
      if (t.type === e.value) return t;
      const next = { ...t, type: e.value };
      if (e.value === "tou" && (!t.bands || t.bands.length < 2)) next.bands = seedBands(t);
      return next;
    }
    case "set-band":
      return updateBand(t, e.band, (b) => ({ ...b, ...e.patch }));
    case "set-window":
      return updateBand(t, e.band, (b) => ({
        ...b,
        windows: b.windows.map((w, j) => (j === e.window ? { ...w, ...e.patch } : w)),
      }));
    case "add-band": {
      // New rates go above the one for all other times, which stays last.
      const at = t.bands.length - (t.bands[t.bands.length - 1]?.other ? 1 : 0);
      const band: TariffBand = { name: `Rate ${t.bands.length + 1}`, rate: t.flat_rate || 0.3, windows: [newWindow()] };
      return { ...t, bands: [...t.bands.slice(0, at), band, ...t.bands.slice(at)] };
    }
    case "remove-band":
      return { ...t, bands: t.bands.filter((_, j) => j !== e.band) };
    case "add-window":
      return updateBand(t, e.band, (b) => ({ ...b, windows: [...b.windows, newWindow()] }));
    case "remove-window":
      return updateBand(t, e.band, (b) => ({ ...b, windows: b.windows.filter((_, j) => j !== e.window) }));
    case "make-other":
      // Only one rate covers the gaps: the previous one gets a time window of its own.
      return {
        ...t,
        bands: t.bands.map((b, j) => {
          if (j === e.band) return { ...b, other: true, windows: [] };
          if (!b.other) return b;
          const { other: _, ...rest } = b;
          return { ...rest, windows: [newWindow()] };
        }),
      };
  }
}

export type EditorStatus = { text: string; bad?: boolean } | null;

/**
 * The rates editor. `draft` is null while showing the server's copy unchanged; any edit, or loading
 * a published plan, makes it a draft that isn't saved until Save rates.
 */
export type EditorState = { draft: Tariff | null; imported: PlanTariff | null; status: EditorStatus };

export type EditorAction =
  | { type: "edit"; base: Tariff; edit: TariffEdit }
  | { type: "import"; plan: PlanTariff }
  | { type: "discard" }
  | { type: "saving" }
  | { type: "saved"; message: string }
  | { type: "failed"; message: string };

export const EDITOR_START: EditorState = { draft: null, imported: null, status: null };

const UNSAVED: EditorStatus = { text: "Unsaved changes." };

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    case "edit":
      return { ...s, draft: applyEdit(s.draft ?? a.base, a.edit), status: UNSAVED };
    case "import":
      return { draft: a.plan.tariff, imported: a.plan, status: UNSAVED };
    case "discard":
      return EDITOR_START;
    case "saving":
      return { ...s, status: { text: "Saving…" } };
    case "saved":
      return { draft: null, imported: null, status: { text: a.message } };
    case "failed":
      return { ...s, status: { text: a.message, bad: true } };
  }
}

/** Settings' pages, as the side nav and the row of pages over them list them. */
export const SETTINGS_TABS = [
  { to: "/settings/system", label: "System", icon: "home" },
  { to: "/settings/bills", label: "Bills", icon: "dollar" },
  { to: "/settings/integrations", label: "Integrations", icon: "plug" },
  { to: "/settings/alerts", label: "Alerts", icon: "bell" },
  { to: "/settings/database", label: "Database", icon: "database" },
  { to: "/settings/account", label: "Account", icon: "user" },
] as const satisfies readonly { to: string; label: string; icon: IconName }[];

export const SETTINGS_SUB = "System details, bills and rates, connected services, alerts and your data";
