import { useLayoutEffect, useState, useSyncExternalStore, type RefObject } from "react";

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
 * Where the highlight under a row of pill links should sit: under the link marked aria-current="page",
 * kept in view when the row scrolls sideways. Re-measured on resize and once web fonts load.
 */
export function usePillIndicator(row: RefObject<HTMLElement | null>, deps: unknown[]) {
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const nav = row.current;
    if (!nav) return;
    const place = () => {
      const cur = nav.querySelector<HTMLElement>('[aria-current="page"]');
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
