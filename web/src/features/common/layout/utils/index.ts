import type { IconName } from "~/features/common/ui/components/Icon";

export type Section = "/" | "/home" | "/history" | "/plan" | "/battery" | "/bills" | "/tesla";

export type NavItem = { to: Section; label: string; icon: IconName };

/** The main sections, in the order the navigation shows them. Settings sits apart, at the end. */
export const NAV: NavItem[] = [
  { to: "/", label: "Overview", icon: "layout" },
  { to: "/home", label: "Home", icon: "home" },
  { to: "/history", label: "History", icon: "chart" },
  { to: "/plan", label: "Plan", icon: "cloudSun" },
  { to: "/battery", label: "Battery", icon: "battery" },
  { to: "/bills", label: "Bills", icon: "dollar" },
  { to: "/tesla", label: "Tesla", icon: "car" },
];

/** Which top-level section a path belongs to: "/home" for "/home/12". */
export const sectionOf = (path: string) => (path === "/" ? "/" : `/${path.split("/")[1]}`);
