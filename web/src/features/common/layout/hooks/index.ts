import { useRouterState } from "@tanstack/react-router";
import { useLayoutEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { useHasBattery } from "~/features/battery/hooks";
import { isFresh } from "~/features/common/energy/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { kW } from "~/features/common/formatting/utils/number";
import { COLOR } from "~/features/common/theme/utils/colors";
import { NAV, type SectionPages } from "~/features/common/layout/utils";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useHomeNavPages } from "~/features/home/hooks";
import { useLive } from "~/features/common/live/hooks/useLive";
import { useNow } from "~/features/common/time/hooks";

function subscribe(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

/** True once the page has scrolled more than `threshold` pixels from the top. */
export function useScrolled(threshold = 4): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.scrollY > threshold,
    () => false, // the prerendered shell is always at the top
  );
}

/**
 * Where the highlight under a row of pills should sit: under the one `selector` picks (by default the
 * link marked aria-current="page"), kept in view when the row scrolls sideways. Re-measured on resize
 * and once web fonts load.
 */
export function usePillIndicator(
  row: RefObject<HTMLElement | null>,
  deps: unknown[],
  selector = '[aria-current="page"]',
) {
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const nav = row.current;
    if (!nav) return;
    const place = () => {
      const cur = nav.querySelector<HTMLElement>(selector);
      if (!cur) return setInd(null);
      setInd({ left: cur.offsetLeft, width: cur.offsetWidth });
      if (cur.offsetLeft < nav.scrollLeft || cur.offsetLeft + cur.offsetWidth > nav.scrollLeft + nav.clientWidth)
        cur.scrollIntoView({ block: "nearest", inline: "center" });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(nav);
    document.fonts?.ready.then(place);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller says what moves the current link
  }, deps);
  return ind;
}

/** The sections to offer: Tesla once a car's connected (until then it's reached from Overview and Integrations), Battery
 * when there is one. */
export function useNavItems() {
  const teslaConnected = !!useLive()?.system.tesla_connected;
  const hasBattery = useHasBattery();
  return NAV.filter((i) => (i.to !== "/tesla" || teslaConnected) && (i.to !== "/battery" || hasBattery));
}

export type LiveState = "live" | "stale" | "error";

/** Whether readings are coming in from the inverter, in a word and a sentence, and the time now (to the minute). */
export function useLiveStatus(): { state: LiveState; status: string; now: number } {
  const st = useLive();
  const now = useNow(30_000);
  const last = st?.last_success;
  let state: LiveState = "live";
  let status = last ? `Live from your inverter, last reading ${hhmm(last)}` : "Connecting to your inverter";
  if (!last) state = st?.error ? "error" : "stale";
  else if (!isFresh(st, now)) {
    state = st?.error ? "error" : "stale";
    status = `No new readings since ${hhmm(last)}`;
  } else if (st?.frozen_since) {
    state = "stale";
    status = `Readings frozen since ${hhmm(st.frozen_since)}`;
  }
  return { state, status, now };
}

/** Whether a media query matches, following it as the window changes (false in the prerendered shell). */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Where the side nav docks in full (the `xl` breakpoint); below it, it's a rail, or a menu on a phone. */
export const NAV_DOCKED = "(min-width: 1000px)";

/** The pages within a section, for the navigation to list; null for a section without any (Overview, System…). */
export function useSectionPages(section: string): SectionPages | null {
  const home = useHomeNavPages(section === "/home");
  const load = useSnapshot()?.load_power;
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (section === "/home" && home.length)
    return {
      title: "Home",
      sub: load != null && load > 0 ? `Using ${kW(load)} now` : "Where your home's power goes",
      root: { link: { to: "/home" }, label: "Whole home", active: path === "/home" },
      pages: home,
    };
  if (section === "/bills")
    return {
      title: "Bills",
      sub: "What it's costing, and everything it's worked out from",
      root: { link: { to: "/bills" }, label: "This period", active: path === "/bills" },
      pages: [
        {
          key: "/bills/rates",
          label: "Rates & settings",
          icon: "tag",
          color: COLOR.good,
          link: { to: "/bills/rates" },
          active: path === "/bills/rates",
        },
      ],
    };
  return null;
}
