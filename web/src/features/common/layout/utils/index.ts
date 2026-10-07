import type { LinkProps } from "@tanstack/react-router";
import type { IconName } from "~/features/common/ui/components/Icon";

export type Section = "/" | "/home" | "/history" | "/plan" | "/battery" | "/bills" | "/tesla";

/** Live: what's happening now. Over time: what happened, what's coming, and what it cost. */
export type NavGroup = "Live" | "Over time";
export const NAV_GROUPS: NavGroup[] = ["Live", "Over time"];

export type NavItem = { to: Section; label: string; icon: IconName; group: NavGroup };

/** The main sections, group by group, in the order the navigation shows them. Settings sits apart, at the end. */
export const NAV: NavItem[] = [
  { to: "/", label: "Overview", icon: "layout", group: "Live" },
  { to: "/home", label: "Home", icon: "home", group: "Live" },
  { to: "/battery", label: "Battery", icon: "battery", group: "Live" },
  { to: "/tesla", label: "Tesla", icon: "car", group: "Live" },
  { to: "/history", label: "History", icon: "chart", group: "Over time" },
  { to: "/plan", label: "Plan", icon: "cloudSun", group: "Over time" },
  { to: "/bills", label: "Bills", icon: "dollar", group: "Over time" },
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
