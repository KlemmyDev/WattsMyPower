import { useEffect, useRef, type CSSProperties } from "react";

type Glow = {
  /** Across, as a % of the page's width, and down, in px, with the page at the top. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** How strong at its middle, as a % of the light's shade. */
  o: number;
  /** How far it moves for each pixel the page scrolls: the further back, the less. */
  depth: number;
  /** Seconds to drift one way (and as long back). */
  drift: number;
};

/** A few soft shapes: the strongest in the top left, then fainter ones down the page on alternate sides. */
const GLOWS: Glow[] = [
  { x: -12, y: -260, w: 1040, h: 840, o: 100, depth: 0.12, drift: 44 },
  { x: 66, y: 80, w: 620, h: 460, o: 62, depth: 0.3, drift: 36 },
  { x: -8, y: 820, w: 760, h: 880, o: 55, depth: 0.22, drift: 52 },
  { x: 58, y: 1500, w: 900, h: 620, o: 48, depth: 0.34, drift: 40 },
];

/**
 * Soft light behind every page, the same on each: a few shapes a shade off the page's background (lighter in the dark
 * theme, darker in the light), held behind the page while it scrolls, each moving up at its own pace (the nearer, the
 * faster) and drifting slowly on its own, for the glass cards to sit over. A fine grain over it all keeps the
 * gradients from banding. Still when motion is turned down.
 */
export function PageGlow() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const set = () => {
      frame = 0;
      el.style.setProperty("--glow-scroll", String(Math.round(window.scrollY)));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(set);
    };
    set();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-y-0 right-0 left-(--nav-w) -z-10 overflow-hidden">
      <div ref={root} className="page-glow absolute inset-0">
        {GLOWS.map((s, i) => (
          <div
            key={i}
            className="page-glow-shape"
            style={
              {
                left: `${s.x}%`,
                top: s.y,
                width: s.w,
                height: s.h,
                "--shape-o": `${s.o}%`,
                "--depth": s.depth,
                "--drift": `${s.drift}s`,
                // Each starts at another point of its drift, so they don't move together.
                animationDelay: `${-(i * 7.3) % s.drift}s`,
              } as CSSProperties
            }
          />
        ))}
        <div className="page-glow-grain" />
      </div>
    </div>
  );
}
