import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "~/features/common/display/utils";

/**
 * A number that glides to each new value instead of jumping (ease-out over `ms`), for live figures
 * that change every minute. The first value shows at once; with motion turned down (on the device or
 * in Manage → Account), so does each.
 */
export function useTween(target: number | null | undefined, ms = 650): number | null {
  const [shown, setShown] = useState(target ?? null);
  const at = useRef(target ?? null);
  useEffect(() => {
    if (target == null) return;
    const from = at.current;
    const jump = from == null || from === target || reducedMotion();
    const t0 = performance.now();
    let frame = 0;
    const step = (t: number) => {
      const k = jump ? 1 : Math.min(1, (t - t0) / ms);
      const v = (from ?? target) + (target - (from ?? target)) * (1 - (1 - k) ** 3);
      at.current = v;
      setShown(v);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return target == null ? null : shown;
}
