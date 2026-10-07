import { useCallback, useLayoutEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { useHasBattery } from "~/features/battery/hooks";
import { isFresh } from "~/features/common/energy/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { NAV } from "~/features/common/layout/utils";
import { useLive } from "~/features/common/live/hooks/useLive";
import { STORE_NAV_COLUMN, store } from "~/features/common/storage/utils";
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

/** The sections to offer: Tesla once a car's connected (until then it's reached from Overview and Settings), Battery
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

// Whether the side nav's column of a section's pages is open: remembered in this browser, open to start.
let navColumn: boolean | undefined;
const navColumnListeners = new Set<() => void>();
const navColumnOpen = () => (navColumn ??= store.get(STORE_NAV_COLUMN) !== "closed");

export function useNavColumn(): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(
    (onChange) => {
      navColumnListeners.add(onChange);
      return () => navColumnListeners.delete(onChange);
    },
    navColumnOpen,
    () => true,
  );
  const set = useCallback((v: boolean) => {
    navColumn = v;
    store.set(STORE_NAV_COLUMN, v ? "open" : "closed");
    navColumnListeners.forEach((f) => f());
  }, []);
  return [open, set];
}
