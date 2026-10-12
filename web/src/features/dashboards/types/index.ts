/** Which screen a layout is for: a computer's wide grid (12 columns) or a phone's (4). */
import type { Screen } from "~/features/common/widgets/types";
export type { Screen };

/** A widget on a dashboard: what it is, where it sits (in grid columns and rows) and how it's set up. */
export type WidgetItem = {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  settings: Record<string, unknown>;
};

/** A dashboard: its name and its widgets, for a computer and (once arranged separately) a phone. */
export type Dashboard = {
  id: string;
  name: string;
  layouts: { computer: WidgetItem[]; phone: WidgetItem[] | null };
};

/** The dashboards as saved; none until they first are (the web app's default stands in). */
export type DashboardsDoc = { v: 1; dashboards: Dashboard[] | null };
