/**
 * Widgets: the cards a feature offers for the Overview's dashboards. Each feature catalogues its own in
 * `features/<feature>/widgets/index.tsx` (exporting `widgets: WidgetDef[]`), using the same components its page shows;
 * the dashboards find every catalogue by themselves, so a feature's new card is a new widget once it's catalogued.
 */
import type { ComponentType } from "react";
import type { AmberPrices } from "~/features/amber/types";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import type { IconName } from "~/features/common/ui/components/Icon";
import type { Forecast } from "~/features/common/weather/types";
import type { EvBrief } from "~/features/ev/types";
import type { HomeOverview } from "~/features/home/types";

/** Which screen a layout is for: a computer's wide grid (12 columns) or a phone's (4). */
export type Screen = "computer" | "phone";

/** What every widget can draw on, read once for the page. */
export type WidgetCtx = {
  now: number;
  p: Snapshot | null;
  s: SystemInfo | undefined;
  f: Forecast | null | undefined;
  prices: AmberPrices | undefined;
  /** It's known there's no battery. */
  noBattery: boolean;
  /** Cars connected, as the live readings have them. */
  cars: EvBrief[];
  /** Smart-home devices and rooms, once read. */
  home: HomeOverview | undefined;
  amber: boolean;
};

export type Settings = Record<string, unknown>;

/**
 * A small picture of a widget, for the list to add it from and its styles: a figure, a line, bars, a ring, a list,
 * the power flow's points, a warning, a lit tile, or the house.
 */
export type Thumb =
  | { kind: "number"; value: string; color: string }
  | { kind: "line" | "bars" | "ring" | "list" | "alert" | "tile" | "table" | "split"; color: string; value?: string }
  | { kind: "flow" | "scene" | "ribbons" | "donut" | "rows" | "tiles" };

export type Choice = { value: string; label: string; thumb?: Thumb };

/** Something about a widget that can be set: a style, a switch, or a choice from a list (fixed, or of what's there). */
export type WidgetOption =
  | { key: string; label: string; kind: "style"; choices: Choice[]; default: string }
  | {
      key: string;
      label: string;
      sub?: string;
      kind: "toggle";
      default: boolean;
      /** Shown only for these settings (a style it applies to). */
      when?: (settings: Settings) => boolean;
      /** The heading it's listed under in the settings, with the others like it ("Readings", "Also show"). */
      section?: string;
      /** Shown only where this is so (a car connected). */
      offered?: (ctx: WidgetCtx) => boolean;
    }
  | {
      key: string;
      label: string;
      kind: "select";
      choices: Choice[] | ((ctx: WidgetCtx) => Choice[]);
      default: string | ((ctx: WidgetCtx) => string);
    };

export type WidgetProps = {
  ctx: WidgetCtx;
  settings: Settings;
  /** Its size in grid columns and rows, to fit what it shows to it. */
  w: number;
  h: number;
  screen: Screen;
};

/** Sizes in grid units: [columns, rows]. On a phone, columns are of 4. */
export type Sizes = { min: [number, number]; max: [number, number]; default: [number, number] };

/** The sections widgets are listed under, as the navigation has them (and the dashboard's own, for any reading). */
export type GroupId = "general" | "overview" | "solar" | "home" | "battery" | "grid" | "car" | "money" | "weather";

export type WidgetDef = {
  type: string;
  name: string;
  sub: string;
  group: GroupId;
  icon: IconName;
  thumb: Thumb;
  sizes: Sizes;
  /** On a phone (4 columns); else the narrow ones half the width, the rest all of it. */
  phone?: Sizes;
  /** Sizes for its settings (a style that needs more room). */
  sizesFor?: (settings: Settings) => Sizes;
  options?: WidgetOption[];
  /** Why it can't be shown yet (nothing connected for it), or null. */
  needs?: (ctx: WidgetCtx) => string | null;
  Component: ComponentType<WidgetProps>;
};
