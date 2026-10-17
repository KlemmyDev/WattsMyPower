import type { ReactNode } from "react";
import type { HistorySeries } from "~/features/common/readings/types";
import type { Pt } from "~/features/live/utils/day";
import type { WeatherDay } from "~/features/weather/types";

/*
 * What a live page gives the top card it shares with the others (LiveCard): its title and colour, its camera spot, what
 * its words and figures say at any moment of the day, and its chart.
 */

export type Figure = { label: string; value: string; unit?: string };
export type Stat = { label: string; value: string; sub?: string };

/**
 * The slim bar under the lead figure, out of 100: filled to `fill` in `color`, dashed on to `ahead` (where it's
 * heading), the reserve hatched in from the left, and ticks for what it's measured against. `label` says it aloud.
 */
export type Slim = {
  label: string;
  fill: number;
  color: string;
  ahead?: number;
  reserve?: number;
  ticks: { at: number; color?: string; title: string }[];
};

/** The page's words and figures at a moment. */
export type LiveMoment = {
  /** How it's going, and a second sentence left off on a phone. */
  story: string;
  more?: string;
  lead: Figure;
  slim: Slim;
  second: Figure & { sub?: string; live: boolean; color: string };
  stats: Stat[];
  /** The car as the page knows it at that moment (EV's, from its own readings): whether it's home, and what it's
   * charging at (kW). Without it the scene goes by the live status. */
  car?: { home: boolean; kw: number };
};

export type ChartProps = {
  view: number;
  scrubbed: boolean;
  onScrub: (t: number) => void;
  /** Play the day and the way back to now, for the chart's top left. */
  controls: ReactNode;
};

export type LiveHero = {
  /** Its camera spot (spots.ts), and its title. */
  page: string;
  title: string;
  /** Its colour, for the play button. */
  color: string;
  /** The car it's about (EV's), by VIN: the one drawn in the scene. Else the first connected. */
  car?: string;
  /** Its words and figures at `view` (scrubbed: a moment chosen along the chart, not now). */
  at: (view: number, scrubbed: boolean) => LiveMoment;
  chart: (p: ChartProps) => ReactNode;
};

/** Today as the live pages share it: the readings the scene needs, the weather, the sun's times, what solar's expected. */
export type LiveDay = {
  now: number;
  start: number;
  rise: number;
  set: number;
  /** Every 5 minutes: pv_power, battery_power, battery_soc, grid_power. */
  series: HistorySeries | undefined;
  weather: WeatherDay | undefined;
  /** Solar expected through the day (W), between the hours. */
  expected: Pt[];
};
