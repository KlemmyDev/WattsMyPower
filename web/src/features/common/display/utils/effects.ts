import { STORE_EFFECTS, store } from "~/features/common/storage/utils";

/**
 * How much the dashboard draws. "full" is frosted glass over drifting light and the Solar sky's every cloud; "lite" is
 * for a device that can't keep up: the glass goes near-solid (no backdrop blur), the light holds still, and the sky
 * draws fewer clouds and less rain without their soft edges. It's on <html> as data-effects for the CSS, and read by
 * what draws a lot (useEffects).
 */
export type Effects = "full" | "lite";

/** How long a device found to struggle stays lite before it's given another try. */
const REMEMBER_MS = 7 * 86_400_000;

let current: Effects = "full";
const listeners = new Set<() => void>();

export const effects = () => current;

export function subscribeEffects(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function set(e: Effects) {
  document.documentElement.dataset.effects = e;
  if (e === current) return;
  current = e;
  listeners.forEach((l) => l());
}

/** What the browser says about itself: saving data, or very little memory or very few cores. */
function lowEnd(): boolean {
  const n = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return !!n.connection?.saveData || (n.deviceMemory ?? 8) <= 2 || (n.hardwareConcurrency ?? 8) <= 2;
}

/**
 * Picks the level once, at the start: lite if this device was found to struggle in the last week or says it's low end,
 * otherwise full, then a couple of seconds of frames are timed once the page has settled. If most of them come slower
 * than about 45 a second, it drops to lite and remembers. Returns a stop for the timing.
 */
export function startEffects(): () => void {
  // "lite" or "full" on its own is a choice that stays (for trying either); "lite:<ms>" is what the timing found.
  const [saved, at] = store.get(STORE_EFFECTS).split(":");
  if (saved === "full" && !at) {
    set("full");
    return () => {};
  }
  if (saved === "lite" && (!at || Date.now() - Number(at) < REMEMBER_MS)) {
    set("lite");
    return () => {};
  }
  if (lowEnd()) {
    set("lite");
    return () => {};
  }
  set("full");
  let frame = 0;
  let tries = 0;
  const time = () => {
    const gaps: number[] = [];
    let last = 0;
    const step = (t: number) => {
      if (last) gaps.push(t - last);
      last = t;
      if (gaps.length < 120) {
        frame = requestAnimationFrame(step);
        return;
      }
      // A hidden tab, or a pause for something else (a long task, a dialog), isn't the device being slow: time again.
      if (document.hidden || gaps.some((g) => g > 400)) {
        if (++tries < 3) timer = window.setTimeout(time, 5000);
        return;
      }
      gaps.sort((a, b) => a - b);
      const slow = gaps.filter((g) => g > 34).length / gaps.length;
      if (gaps[gaps.length >> 1] > 22 || slow > 0.3) {
        store.set(STORE_EFFECTS, `lite:${Date.now()}`);
        set("lite");
      }
    };
    frame = requestAnimationFrame(step);
  };
  let timer = window.setTimeout(time, 2500);
  return () => {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
  };
}
