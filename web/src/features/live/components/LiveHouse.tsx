import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { reducedMotion, savedDisplay } from "~/features/common/display/utils";
import type { HouseOptions } from "~/features/overview/utils/house/layout";
import {
  FRAME,
  geometry,
  houseArt,
  houseKey,
  slotMarkup,
  type HouseArt,
  type HouseState,
  type Op,
  type Light,
  type Pose,
  type SceneParts,
} from "~/features/live/utils/house3d";
import { drawOps } from "~/features/live/utils/houseCanvas";
import { pacer } from "~/features/live/utils/pace";
import { between, FLIGHT_MS, INTRO_MS, spotPose } from "~/features/live/utils/spots";

/** The most pixels per CSS pixel a flight's canvas draws at. */
const FLIGHT_DPR = 2;
/** How long the flight's canvas takes to fade in over the house's picture as it takes off, and off it as it lands (ms). */
const SWAP_MS = 200;

/** Once a visit: Solar's tilt up from the house to its roof. */
const TILTED = "wmp-solar-tilt";

type Flight = { from: Pose; to: Pose; t0: number; ms: number; raf: number; frame: FrameRequestCallback };

/** How long the old picture takes to fade out over the new one (ms), when the page fades rather than flies. */
const FADE_MS = 380;

/**
 * How this browser moves between the live pages (Settings → Account → Appearance): the camera flies, the picture
 * fades, or it just changes. "Auto" flies, or fades on a device that can't keep up (`lite`); less motion always cuts.
 */
function moveBy(lite: boolean): "fly" | "fade" | "off" {
  if (reducedMotion()) return "off";
  const t = savedDisplay().transition;
  return t === "auto" ? (lite ? "fade" : "fly") : t;
}

/** At rest, the house is drawn again at most this often (ms) as the day's scrubbed or played (lite: half as often). */
const REST_MS = 100;

/**
 * Your house along the bottom of the live pages' sky, through a camera at the page's spot (spots.ts): Solar's low on
 * the front corner, Battery's close on the battery. Changing page flies the camera from one spot to the next (cut
 * straight there with motion turned down), redrawing the house each frame only while it flies; at rest it's drawn once
 * per change of camera or light (and those pictures are kept). It keeps its own palette in either theme (it's a picture
 * of the sky) and is lit by the real sun and the sky (house3d.ts), with what moves (the power, the battery's level, the
 * light over it all) laid over it.
 *
 * The first time Solar opens in a visit, the camera starts low on the wall and the garden and tilts up to the roof (only
 * when the pages fly). Set to fade (or on a device that can't keep up), the new spot is drawn once under the old
 * picture, which fades out over it.
 *
 * React draws the frame and nothing in it: the house is SVG markup written straight into layers of their own (house3d's
 * `layers`), so a flight or a scrub never re-renders thousands of paths. What moves (the power, the glass's sheen,
 * the battery's lights) has layers of its own, each its own picture on the screen, so its animations repaint only it
 * and never the house around it; it's written again only when what it shows has changed, carrying on where it was.
 */
export const LiveHouse = memo(function LiveHouse({
  house,
  spot,
  phone,
  light,
  parts,
  state,
  lite,
}: {
  house: HouseOptions;
  spot: string;
  phone: boolean;
  light: Light;
  /** Whether the car's home, and its paint. */
  parts: SceneParts;
  state: Omit<HouseState, "now">;
  lite: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const cvs = useRef<HTMLCanvasElement>(null);
  const onCanvas = useRef(false);
  const swap = useRef<Animation | null>(null);
  const hkey = houseKey(house);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the house as drawn, by what makes it differ
  const g = useMemo(() => geometry(house), [hkey]);
  const target = spotPose(spot, g, phone);
  const targetKey = `${spot}|${phone}|${hkey}`;

  // What the drawing needs, always the latest, for a flight's frames to read.
  const latest = useRef({ house, phone, light, parts, state, lite, target });
  useLayoutEffect(() => {
    latest.current = { house, phone, light, parts, state, lite, target };
  });
  const pose = useRef<Pose | null>(null);
  const flight = useRef<Flight | null>(null);
  const drawn = useRef<{ art: HouseArt | null; layers: string[]; looks: string[] }>({
    art: null,
    layers: [],
    looks: [],
  });

  /** Draws the house through `at`: its picture (kept, unless it's a flight's frame) and what moves over it. */
  const paint = (at: Pose, keep: boolean) => {
    const L = latest.current;
    if (onCanvas.current && keep) {
      // Landed: the SVG picture (with what moves, and the trees' every face) shows again under the flight's canvas,
      // which fades off it.
      onCanvas.current = false;
      if (box.current) box.current.style.visibility = "";
      const cv = cvs.current;
      if (cv) {
        swap.current?.cancel();
        swap.current = cv.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SWAP_MS, easing: "ease-out" });
        swap.current.onfinish = () => (cv.style.display = "none");
      }
    }
    const art = houseArt(L.house, L.phone, at, L.light, L.parts, L.lite, keep);
    pose.current = at;
    const el = box.current;
    if (!el) return;
    const D = drawn.current;
    if (D.art !== art) {
      // One SVG per layer, in order; only the layers whose markup changed are written again.
      const frame = `0 0 ${art.w} ${art.h}`;
      while (el.children.length < art.layers.length) el.appendChild(layer());
      while (el.children.length > art.layers.length) el.lastChild!.remove();
      art.layers.forEach((l, i) => {
        const svg = el.children[i];
        if (svg.getAttribute("viewBox") !== frame) svg.setAttribute("viewBox", frame);
        svg.classList.toggle("lh-live", l.live);
        if (D.layers[i] === l.svg) return;
        svg.innerHTML = l.svg;
        D.layers[i] = l.svg;
        D.looks = [];
      });
      D.layers.length = art.layers.length;
      D.art = art;
    }
    // What moves is written into its slots again only when what it shows has changed (a reading a few watts off the
    // last draws the same), and then carries on from where it was.
    const s = { ...L.state, now: 0 };
    let now = 0;
    el.querySelectorAll<SVGGElement>("g[data-slot]").forEach((g) => {
      const i = Number(g.getAttribute("data-slot"));
      const slot = art.slots[i];
      if (!slot) return;
      const look = slotMarkup(art, slot, s);
      if (D.looks[i] === look) return;
      now ||= performance.now();
      g.innerHTML = slotMarkup(art, slot, { ...s, now });
      D.looks[i] = look;
    });
  };

  // At rest, drawn at most every REST_MS (the last change always drawn), so the day playing doesn't draw the house on
  // every frame of it.
  const rest = useRef({ at: 0, timer: 0 });
  const settle = () => {
    const R = rest.current;
    if (flight.current || !pose.current) return;
    const wait = REST_MS * (latest.current.lite ? 2 : 1) - (performance.now() - R.at);
    if (wait > 0) {
      R.timer ||= window.setTimeout(() => {
        R.timer = 0;
        settle();
      }, wait);
      return;
    }
    R.at = performance.now();
    paint(latest.current.target, true);
  };

  /** A flight's frame, drawn straight to the canvas from the projected shapes (no markup written or parsed). */
  const flightFrame = (at: Pose) => {
    const L = latest.current;
    const cv = cvs.current;
    const el = cv?.parentElement;
    if (!cv || !el || !box.current) return paint(at, false);
    const ops: Op[] = [];
    const art = houseArt(L.house, L.phone, at, L.light, L.parts, L.lite, false, ops);
    pose.current = at;
    const dpr = Math.min(window.devicePixelRatio || 1, FLIGHT_DPR);
    const W = Math.round(el.clientWidth * dpr);
    const H = Math.round(el.clientHeight * dpr);
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    }
    drawOps(cv, ops, art.w, art.h);
    if (!onCanvas.current) {
      // Taking off: the canvas fades in over the SVG picture, which then hides (its moving parts stop repainting).
      onCanvas.current = true;
      cv.style.display = "block";
      const el = box.current;
      swap.current?.cancel();
      swap.current = cv.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SWAP_MS, easing: "ease-out" });
      swap.current.onfinish = () => {
        if (onCanvas.current) el.style.visibility = "hidden";
      };
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
      frame: () => {},
    };
    flight.current = f;
    // A device that can't keep up gets the flight at 30 frames a second, so each one has time to be drawn.
    const pace = pacer(latest.current.lite);
    const frame = (now: number) => {
      if (flight.current !== f) return;
      if (!pace(now)) {
        f.raf = requestAnimationFrame(frame);
        return;
      }
      f.to = latest.current.target;
      const k = Math.max(0, Math.min(1, (now - f.t0) / f.ms));
      if (k >= 1) {
        flight.current = null;
        paint(f.to, true);
        return;
      }
      flightFrame(between(f.from, f.to, k));
      f.raf = requestAnimationFrame(frame);
    };
    f.frame = frame;
    flightFrame(from);
    f.raf = requestAnimationFrame(frame);
  };

  // The new spot drawn once under the old picture, which fades out over it: its layers move to a cover of their own
  // (nothing's copied), and the house is drawn into new ones.
  const fade = () => {
    const el = box.current;
    if (flight.current) cancelAnimationFrame(flight.current.raf);
    flight.current = null;
    if (!el?.parentElement || !el.firstChild) return paint(latest.current.target, true);
    el.parentElement.querySelector(".lh-fade")?.remove();
    const cover = document.createElement("div");
    cover.className = "lh-fade";
    cover.style.animationDuration = `${FADE_MS}ms`;
    while (el.firstChild) cover.appendChild(el.firstChild);
    drawn.current = { art: null, layers: [], looks: [] };
    el.parentElement.appendChild(cover);
    paint(latest.current.target, true);
    const done = () => cover.remove();
    cover.addEventListener("animationend", done, { once: true });
    window.setTimeout(done, FADE_MS + 200);
  };

  // A new spot (another page, or your house changed): fly there, fade there or cut there, as this browser's set to.
  const firstKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (firstKey.current == null) {
      firstKey.current = targetKey;
      if (spot === "solar" && moveBy(lite) === "fly" && firstVisit())
        fly(spotPose("solar-intro", g, phone), INTRO_MS, 250);
      else paint(target, true);
      return;
    }
    const from = pose.current;
    const samePage = firstKey.current.split("|")[0] === spot;
    firstKey.current = targetKey;
    const move = moveBy(lite);
    // Only the size changed (a phone turned, a window resized), or there's nowhere to fly from: no flight.
    if (!from || samePage || move === "off") {
      if (flight.current && samePage) return; // a flight under way just lands on the new spot
      if (flight.current) cancelAnimationFrame(flight.current.raf);
      flight.current = null;
      paint(target, true);
      return;
    }
    if (move === "fade") fade();
    else fly(from, FLIGHT_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flies on a new spot only
  }, [targetKey]);

  // Anything else (the light, the power, the battery's level): drawn again at rest; a flight's next frame has it.
  useLayoutEffect(() => {
    settle();
  });

  // Leaving, a flight stops; back again (React trying the page twice in development), it carries on.
  useLayoutEffect(() => {
    const f = flight.current;
    if (f && !f.raf) f.raf = requestAnimationFrame(f.frame);
    const R = rest.current;
    return () => {
      clearTimeout(R.timer);
      R.timer = 0;
      const g = flight.current;
      if (!g) return;
      cancelAnimationFrame(g.raf);
      g.raf = 0;
    };
  }, []);

  const { w, h } = phone ? FRAME.phone : FRAME.wide;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMin slice" className="absolute inset-0 size-full">
        <HouseDefs w={w} h={h} />
      </svg>
      <div ref={box} className="contents" />
      <canvas ref={cvs} className="absolute inset-0 size-full" style={{ display: "none" }} />
    </div>
  );
});

/** One of the house's layers: an SVG over the whole sky, framed as the picture is. */
function layer(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("preserveAspectRatio", "xMidYMin slice");
  svg.setAttribute("class", "lh-layer");
  return svg;
}

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

/** The glass's and windows' colours (and their light at night), the sheen, and the moon in the glass. Only one live sky is ever on a page, so
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
      <radialGradient id="lh-winlit" cx={0.5} cy={0.85} r={0.95}>
        <stop offset={0} stopColor="#fff0c4" />
        <stop offset={0.45} stopColor="#ffc978" />
        <stop offset={1} stopColor="#d9823f" />
      </radialGradient>
      <radialGradient id="lh-spill">
        <stop offset={0} stopColor="#ffd590" stopOpacity={0.55} />
        <stop offset={0.5} stopColor="#ffc06a" stopOpacity={0.18} />
        <stop offset={1} stopColor="#ffb04f" stopOpacity={0} />
      </radialGradient>
      <linearGradient id="lh-blind" x1={0} y1={0} x2={0} y2={1}>
        <stop offset={0} stopColor="#6a3a18" stopOpacity={0.55} />
        <stop offset={0.22} stopColor="#6a3a18" stopOpacity={0.25} />
        <stop offset={0.3} stopColor="#6a3a18" stopOpacity={0} />
      </linearGradient>
      <radialGradient id="lh-moon">
        <stop offset={0} stopColor="#dfe7ff" stopOpacity={0.9} />
        <stop offset={1} stopColor="#dfe7ff" stopOpacity={0} />
      </radialGradient>
    </defs>
  );
});
