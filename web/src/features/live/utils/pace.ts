/** The gap a held-back animation leaves between its frames (ms): 30 a second, with room for a screen's jitter. */
const HELD_MS = 32;

/**
 * Paces an animation drawn frame by frame (a camera's flight, the day playing): every frame while the device keeps up,
 * then 30 a second once a few frames come late, so each one has time to be drawn rather than half of them dropped
 * unevenly. `held` starts it at 30 (a device already found to struggle). Call it with each frame's time; it says
 * whether to draw that one.
 */
export function pacer(held: boolean): (now: number) => boolean {
  let shown = 0;
  let late = 0;
  let gap = held ? HELD_MS : 0;
  return (now) => {
    if (shown && now - shown < gap) return false;
    if (shown && !gap) {
      late = now - shown > 24 ? late + 1 : Math.max(0, late - 1);
      if (late >= 3) gap = HELD_MS;
    }
    shown = now;
    return true;
  };
}
