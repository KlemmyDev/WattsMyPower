import { createContext, useContext, useLayoutEffect } from "react";
import type { LiveDay, LiveHero } from "~/features/live/types";

export const HeroContext = createContext<((hero: LiveHero | null) => void) | null>(null);
export const DayContext = createContext<LiveDay | null>(null);

/**
 * Gives the live pages' top card this page's title, words, figures and chart (memoise it: it's given again whenever it
 * changes). Null when the page has nothing for the card (Battery without a battery).
 */
export function useLiveHero(hero: LiveHero | null) {
  const set = useContext(HeroContext);
  useLayoutEffect(() => set?.(hero), [set, hero]);
}

/** Today as the live pages share it (readings, weather, the sun's times); only inside the live pages' layout. */
export function useLiveDay(): LiveDay {
  const day = useContext(DayContext);
  if (!day) throw new Error("useLiveDay is for the live pages, inside their layout");
  return day;
}
