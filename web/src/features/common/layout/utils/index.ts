import type { LinkProps } from "@tanstack/react-router";
import { COLOR } from "~/features/common/theme/utils/colors";
import type { IconName } from "~/features/common/ui/components/Icon";

export type Section =
  | "/"
  | "/solar"
  | "/home"
  | "/grid"
  | "/history"
  | "/plan"
  | "/battery"
  | "/bills"
  | "/tesla"
  | "/system"
  | "/integrations"
  | "/data";

/**
 * Live: what's happening now. Insights: what happened, what's coming, and what it cost. Manage: setting it all up
 * (what were Settings' pages).
 */
export type NavGroup = "Live" | "Insights" | "Manage";
export const NAV_GROUPS: NavGroup[] = ["Live", "Insights", "Manage"];

/**
 * `color`: the section's own colour, its node's glow once the wire's power reaches it. `group`: none for Overview,
 * which sits on its own at the top, above the groups.
 */
/** Manage's colour: quiet, as it powers nothing. */
export const MANAGE_COLOR = COLOR.gridSoft;

export type NavItem = { to: Section; label: string; icon: IconName; group?: NavGroup; color: string };

/** The sections, Overview then group by group, in the order the navigation shows them. */
export const NAV: NavItem[] = [
  { to: "/", label: "Overview", icon: "layout", color: COLOR.brand },
  { to: "/solar", label: "Solar", icon: "sun", group: "Live", color: COLOR.solar },
  { to: "/home", label: "Home", icon: "home", group: "Live", color: COLOR.teal },
  { to: "/battery", label: "Battery", icon: "battery", group: "Live", color: COLOR.battery },
  { to: "/grid", label: "Grid", icon: "grid", group: "Live", color: COLOR.import },
  { to: "/tesla", label: "Tesla", icon: "car", group: "Live", color: COLOR.danger },
  { to: "/history", label: "History", icon: "chart", group: "Insights", color: COLOR.lilac },
  { to: "/plan", label: "Plan", icon: "cloudSun", group: "Insights", color: COLOR.export },
  { to: "/bills", label: "Bills", icon: "dollar", group: "Insights", color: COLOR.good },
  { to: "/system", label: "System", icon: "settings", group: "Manage", color: MANAGE_COLOR },
  { to: "/integrations", label: "Integrations", icon: "plug", group: "Manage", color: MANAGE_COLOR },
  { to: "/data", label: "Data", icon: "database", group: "Manage", color: MANAGE_COLOR },
];

/** Which top-level section a path belongs to: "/home" for "/home/12". */
export const sectionOf = (path: string) => (path === "/" ? "/" : `/${path.split("/")[1]}`);

/** A page within a section (a device of Home's, a Settings page), as the side nav and the row over a page list it. */
export type NavPage = {
  key: string;
  label: string;
  link: LinkProps;
  /** It's the page shown, or the page shown belongs to it (a room, on one of its devices' pages). */
  active: boolean;
  icon?: IconName;
  /** Its colour (a room's, a device's), its node's glow when it's the current page. */
  color?: string;
  /** A short reading beside it ("412 W"). */
  value?: string;
  /** Its part of the section's busiest, 0 to 1, drawn as a bar where there's room. */
  share?: number;
  /** The heading it's listed under, with that heading's reading. */
  group?: string;
  groupValue?: string;
};

/** A section's pages, with the section's own first page when it has one ("All devices", for Home). */
export type SectionPages = {
  title: string;
  sub?: string;
  root?: { link: LinkProps; label: string; active: boolean };
  pages: NavPage[];
};
