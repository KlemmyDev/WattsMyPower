import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { reducedMotion } from "~/features/common/display/utils";
import type { HouseOptions } from "~/features/overview/utils/house/layout";
import {
  FRAME,
  geometry,
  houseArt,
  houseKey,
  houseOverlay,
  type HouseArt,
  type HouseState,
  type Light,
  type Pose,
} from "~/features/live/utils/house3d";
import { between, FLIGHT_MS, INTRO_MS, spotPose } from "~/features/live/utils/spots";

/** Once a visit: Solar's tilt up from the house to its roof. */
const TILTED = "wmp-solar-tilt";

type Flight = { from: Pose; to: Pose; t0: number; ms: number; raf: number; shown: number; frame: FrameRequestCallback };

/**
 * Your house along the bottom of the live pages' sky, through a camera at the page's spot (spots.ts): Solar's low on
 * the front corner, Battery's close on the battery. Changing page flies the camera from one spot to the next (cut
 * straight there with motion turned down), redrawing the house each frame only while it flies; at rest it's drawn once
 * per change of camera or light (and those pictures are kept). It keeps its own palette in either theme (it's a picture
 * of the sky) and is lit by the real sun and the sky (house3d.ts), with what moves (the power, the battery's level, the
 * light over it all) laid over it.
 *
 * The first time Solar opens in a visit, the camera starts low on the wall and the garden and tilts up to the roof (not
 * with motion turned down).
 *
 * React draws the frame and nothing in it: the house is SVG markup written straight into two groups, so a flight or a
 * scrub never re-renders thousands of paths.
 */
export const LiveHouse = memo(function LiveHouse({
  house,
  spot,
  phone,
  light,
  state,
  lite,
}: {
  house: HouseOptions;
  spot: string;
  phone: boolean;
  light: Light;
  state: Omit<HouseState, "now">;
  lite: boolean;
}) {
  const still = useRef<SVGGElement>(null);
  const moving = useRef<SVGGElement>(null);
  const hkey = houseKey(house);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the house as drawn, by what makes it differ
  const g = useMemo(() => geometry(house), [hkey]);
  const target = spotPose(spot, g, phone);
  const targetKey = `${spot}|${phone}|${hkey}`;

  // What the drawing needs, always the latest, for a flight's frames to read.
  const latest = useRef({ house, phone, light, state, lite, target });
  useLayoutEffect(() => {
    latest.current = { house, phone, light, state, lite, target };
  });
  const pose = useRef<Pose | null>(null);
  const flight = useRef<Flight | null>(null);
  const drawn = useRef<{ art: HouseArt | null; svg: string; over: string }>({ art: null, svg: "", over: "" });

  /** Draws the house through `at`: its picture (kept, unless it's a flight's frame) and what moves over it. */
  const paint = (at: Pose, keep: boolean) => {
    const L = latest.current;
    const art = houseArt(L.house, L.phone, at, L.light, L.lite, keep);
    pose.current = at;
    if (still.current && drawn.current.svg !== art.svg) {
      still.current.innerHTML = art.svg;
      drawn.current.svg = art.svg;
    }
    // What moves is written again only when it's changed (its comets carry on from where they were when it is).
    const s = L.state;
    const over = `${s.share.toFixed(3)}|${s.on}|${s.battery.w}|${s.battery.level?.toFixed(1)}|${s.light.es.toFixed(3)}|${s.light.cover}|${s.light.rain}|${s.light.moon.toFixed(2)}|${s.light.horizon}`;
    if (moving.current && (drawn.current.art !== art || drawn.current.over !== over)) {
      moving.current.innerHTML =
        `<clipPath id="lh-glassclip"><path d="${art.glass}"/></clipPath>` +
        houseOverlay(art, { ...s, now: performance.now() });
      drawn.current.art = art;
      drawn.current.over = over;
    }
  };

  const fly = (from: Pose, ms: number, delay = 0) => {
    if (flight.current) cancelAnimationFrame(flight.current.raf);
    const f: Flight = {
      from,
      to: latest.current.target,
      t0: performance.now() + delay,
      ms,
      raf: 0,
      shown: 0,
      frame: () => {},
    };
    flight.current = f;
    const frame = (now: number) => {
      if (flight.current !== f) return;
      // A device that can't keep up gets the flight at 30 frames a second, so each one has time to be drawn.
      if (latest.current.lite && now - f.shown < 32) {
        f.raf = requestAnimationFrame(frame);
        return;
      }
      f.shown = now;
      f.to = latest.current.target;
      const k = Math.max(0, Math.min(1, (now - f.t0) / f.ms));
      if (k >= 1) {
        flight.current = null;
        paint(f.to, true);
        return;
      }
      paint(between(f.from, f.to, k), false);
      f.raf = requestAnimationFrame(frame);
    };
    f.frame = frame;
    paint(from, false);
    f.raf = requestAnimationFrame(frame);
  };

  // A new spot (another page, or your house changed): fly there, or cut there with motion turned down.
  const firstKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (firstKey.current == null) {
      firstKey.current = targetKey;
      if (spot === "solar" && firstVisit()) fly(spotPose("solar-intro", g, phone), INTRO_MS, 250);
      else paint(target, true);
      return;
    }
    const from = pose.current;
    const samePage = firstKey.current.split("|")[0] === spot;
    firstKey.current = targetKey;
    // Only the size changed (a phone turned, a window resized), or there's nowhere to fly from: no flight.
    if (!from || samePage || reducedMotion()) {
      if (flight.current && samePage) return; // a flight under way just lands on the new spot
      if (flight.current) cancelAnimationFrame(flight.current.raf);
      flight.current = null;
      paint(target, true);
      return;
    }
    fly(from, FLIGHT_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flies on a new spot only
  }, [targetKey]);

  // Anything else (the light, the power, the battery's level): drawn again at rest; a flight's next frame has it.
  useLayoutEffect(() => {
    if (!flight.current && pose.current) paint(target, true);
  });

  // Leaving, a flight stops; back again (React trying the page twice in development), it carries on.
  useLayoutEffect(() => {
    const f = flight.current;
    if (f && !f.raf) f.raf = requestAnimationFrame(f.frame);
    return () => {
      const g = flight.current;
      if (!g) return;
      cancelAnimationFrame(g.raf);
      g.raf = 0;
    };
  }, []);

  const { w, h } = phone ? FRAME.phone : FRAME.wide;
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMin slice"
      className="pointer-events-none absolute inset-0 size-full"
    >
      <HouseDefs w={w} h={h} />
      <g ref={still} />
      <g ref={moving} />
    </svg>
  );
});

/** Whether this is Solar's first showing this visit (and motion's welcome): then it tilts up to the roof. */
function firstVisit(): boolean {
  if (reducedMotion()) return false;
  try {
    if (sessionStorage.getItem(TILTED)) return false;
    sessionStorage.setItem(TILTED, "1");
  } catch {
    return false;
  }
  return true;
}

/** The glass's and windows' colours, the sheen, and the moon in the glass. Only one live sky is ever on a page, so
 * their ids are fixed (the house's markup names them). */
const HouseDefs = memo(function HouseDefs({ w, h }: { w: number; h: number }) {
  return (
    <defs>
      <linearGradient id="lh-glass" gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={w * 0.3} y2={h}>
        <stop offset={0} stopColor="#3b5486" />
        <stop offset={0.45} stopColor="#22375f" />
        <stop offset={1} stopColor="#121c33" />
      </linearGradient>
      <linearGradient id="lh-win" x1={0} y1={0} x2={1} y2={1}>
        <stop offset={0} stopColor="#d7e6f7" />
        <stop offset={0.45} stopColor="#a9c1de" />
        <stop offset={1} stopColor="#8aa6c9" />
      </linearGradient>
      <linearGradient id="lh-sheen" x1={0} y1={0} x2={1} y2={0}>
        <stop offset={0} stopColor="#fff6e0" stopOpacity={0} />
        <stop offset={0.5} stopColor="#fff6e0" />
        <stop offset={1} stopColor="#fff6e0" stopOpacity={0} />
      </linearGradient>
      <radialGradient id="lh-moon">
        <stop offset={0} stopColor="#dfe7ff" stopOpacity={0.9} />
        <stop offset={1} stopColor="#dfe7ff" stopOpacity={0} />
      </radialGradient>
    </defs>
  );
});
