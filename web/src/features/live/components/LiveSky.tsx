import { memo, useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { cn } from "~/features/common/ui/utils";
import { orbits, ORBS, type Atmosphere, type Field } from "~/features/solar/utils/atmosphere";
import { moonAge, moonFace } from "~/features/solar/utils/sky";

/**
 * The live pages' sky at `view` in its "Atmosphere" look (`a`, from utils/atmosphere): the base colours, the drifting colour fields, the sun
 * or moon, stars, fog, your house along the bottom, rain, a storm's flashes, grain, and the wash behind the title.
 *
 * Built to stay smooth on a phone. The colours (every gradient) only change every five minutes of sky, so while the
 * day plays they're repainted a few times a second, not on every frame; the sun and moon move every frame, but only
 * by transform. Everything that moves for good (the fields' drift, fog, rain) moves by transform or opacity alone, and
 * nothing uses blur, masks or blend modes. `lite` (a device that can't keep up) holds the fields and fog still and
 * drops the sheen.
 */
export function SkyScene({
  view,
  start,
  rise,
  set,
  south,
  lite,
  W,
  H,
  phone,
  a,
  roof,
}: {
  view: number;
  start: number;
  rise: number;
  set: number;
  south: boolean;
  lite: boolean;
  W: number;
  H: number;
  phone: boolean;
  a: Atmosphere;
  /** Your house, low across the sky: over its light and fog, under its rain. */
  roof: ReactNode;
}) {
  const o = orbits((view - start) / 3600, (rise - start) / 3600, (set - start) / 3600);
  const G = phone ? ORBS.phone : ORBS.wide;
  // An orb `size` across, centred on a point of the sky, moved only by transform.
  const orb = (x: number, y: number, size: number, scale = 1): CSSProperties => ({
    width: size,
    height: size,
    transform: `translate3d(${(x * W - size / 2).toFixed(1)}px, ${(y * H - size / 2).toFixed(1)}px, 0) scale(${scale.toFixed(3)})`,
  });
  const age = moonAge(view);

  return (
    <div aria-hidden className={cn("atm pointer-events-none absolute inset-0 overflow-hidden", lite && "atm-lite")}>
      <div className="absolute inset-0" style={{ background: a.base }} />
      {/* Keyed by kind, so an aurora coming or going at the ends of the day doesn't start the fields' drift over. */}
      {a.aurora.map((f, i) => (
        <AtmField key={`a${i}`} f={f} aurora />
      ))}
      {a.fields.map((f, i) => (
        <AtmField key={`f${i}`} f={f} aurora={false} />
      ))}
      {a.stars > 0.01 && <Stars opacity={a.stars} />}
      <div className="atm-orb" style={orb(o.sun.x, o.sun.y, G.bloom, a.sun.bloomScale)}>
        <div className="atm-bloom" style={{ background: a.sun.bloom }} />
      </div>
      <div className="atm-orb" style={{ ...orb(o.sun.x, o.sun.y, G.glow), background: a.sun.glow }} />
      <div
        className="atm-orb"
        style={{ ...orb(o.sun.x, o.sun.y, G.core), background: a.sun.core, opacity: a.sun.coreOpacity }}
      />
      <div
        className="atm-orb"
        style={{ ...orb(o.moon.x, o.moon.y, G.halo, a.moon.haloScale), background: a.moon.halo }}
      />
      <div className="atm-orb atm-ring" style={{ ...orb(o.moon.x, o.moon.y, G.ring), opacity: a.moon.ringOpacity }} />
      <div
        className="atm-orb rounded-full"
        style={{ ...orb(o.moon.x, o.moon.y, G.moon), opacity: a.moon.coreOpacity, ...moonFace(age, G.moon, south) }}
      />
      {a.fog.bands.length > 0 && (
        <div className="atm-fade absolute inset-0" style={{ opacity: a.fog.opacity }}>
          {a.fog.bands.map((b, i) => (
            <div
              key={i}
              className="atm-fog"
              style={{
                top: `${((b.cy - b.ry) * 100).toFixed(1)}%`,
                height: `${(b.ry * 200).toFixed(1)}%`,
                background: b.background,
                animationDuration: `${b.secs}s`,
                animationDirection: b.reverse ? "alternate-reverse" : undefined,
              }}
            />
          ))}
        </div>
      )}
      {roof}
      {a.rain > 0.005 && <Rain opacity={a.rain} lite={lite} />}
      {a.storm > 0 && <Flashes opacity={a.storm} />}
      <Grain />
      {/* Everything sets into the card's ground. */}
      <div className="absolute inset-x-0 bottom-0 h-[70px] bg-linear-to-b from-transparent via-surface/50 to-surface" />
      {/* The wash behind the title: the sky's own top colour, deeper, only as strong as the words need. */}
      <div className="absolute inset-0" style={{ background: a.wash }} />
    </div>
  );
}

/** One soft colour field, drifting slowly by transform (held still on a device that can't keep up). */
const AtmField = memo(function AtmField({ f, aurora }: { f: Field; aurora: boolean }) {
  return (
    <div
      className={cn("atm-field", aurora ? "atm-drift-aurora" : `atm-drift-${f.drift}`)}
      style={{
        left: `${((f.cx - f.rx) * 100).toFixed(2)}%`,
        top: `${((f.cy - f.ry) * 100).toFixed(2)}%`,
        width: `${(f.rx * 200).toFixed(2)}%`,
        height: `${(f.ry * 200).toFixed(2)}%`,
        background: f.background,
        animationDuration: `${f.secs}s`,
        animationDirection: f.reverse ? "alternate-reverse" : undefined,
      }}
    />
  );
});

/** Rain: fine streaks of light falling at a slant in two depths, each one tiled layer moved by transform, and a slow sheen. */
const Rain = memo(function Rain({ opacity, lite }: { opacity: number; lite: boolean }) {
  return (
    <div className="atm-fade absolute inset-0 overflow-hidden" style={{ opacity }}>
      {!lite && <div className="atm-sheen" />}
      <div className="atm-rain">
        <div className="atm-streaks" style={{ backgroundImage: STREAKS_FAR }} />
        {!lite && <div className="atm-streaks atm-streaks-near" style={{ backgroundImage: STREAKS_NEAR }} />}
      </div>
    </div>
  );
});

/** A tile of rain streaks as an SVG image, the same every time: `n` lines of light fading in and out down their length. */
function streakTile(seed: number, n: number, len: [number, number], alpha: [number, number]) {
  let s = seed;
  const r = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const lines = Array.from({ length: n }, () => {
    const x = (r() * 240).toFixed(1);
    const y = (r() * 300).toFixed(1);
    const l = (len[0] + r() * (len[1] - len[0])).toFixed(0);
    const a = (alpha[0] + r() * (alpha[1] - alpha[0])).toFixed(2);
    return `<rect x='${x}' y='${y}' width='1' height='${l}' rx='0.5' fill='url(%23g)' opacity='${a}'/>`;
  }).join("");
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='300'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'>` +
    `<stop offset='0' stop-color='%23e2ecff' stop-opacity='0'/><stop offset='0.6' stop-color='%23e2ecff'/><stop offset='1' stop-color='%23e2ecff' stop-opacity='0'/>` +
    `</linearGradient></defs>${lines}</svg>`;
  return `url("data:image/svg+xml,${svg.replace(/</g, "%3C").replace(/>/g, "%3E")}")`;
}
const STREAKS_FAR = streakTile(11, 14, [40, 70], [0.25, 0.5]);
const STREAKS_NEAR = streakTile(29, 8, [70, 120], [0.35, 0.65]);

/** A storm's flashes, out of step with each other. */
const Flashes = memo(function Flashes({ opacity }: { opacity: number }) {
  return (
    <div className="atm-fade absolute inset-0" style={{ opacity }}>
      <div
        className="sky-flash"
        style={{
          background:
            "radial-gradient(ellipse 55% 60% at 64% 18%, rgba(226,232,255,0.6), rgba(190,205,255,0.14) 55%, rgba(190,205,255,0) 80%)",
        }}
      />
      <div
        className="sky-flash sky-later"
        style={{
          background:
            "radial-gradient(ellipse 45% 50% at 22% 14%, rgba(226,232,255,0.45), rgba(190,205,255,0.1) 55%, rgba(190,205,255,0) 80%)",
        }}
      />
    </div>
  );
});

/**
 * A fine film grain over the sky, which also keeps its soft gradients from banding: a small tile of noise drawn once
 * on a canvas and repeated, with no filter or blend mode.
 */
const Grain = memo(function Grain() {
  const [tile] = useState(grainTile);
  return tile ? <div className="atm-grain" style={{ backgroundImage: `url(${tile})` }} /> : null;
});
let grain: string | null | undefined;
function grainTile(): string | null {
  if (grain !== undefined) return grain;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d");
    if (!x) return (grain = null);
    const img = x.createImageData(128, 128);
    let s = 7;
    for (let i = 0; i < img.data.length; i += 4) {
      s = (s * 16807) % 2147483647;
      const v = s / 2147483647;
      const light = v > 0.5;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = light ? 255 : 0;
      img.data[i + 3] = Math.round(Math.abs(v - 0.5) * 2 * 40);
    }
    x.putImageData(img, 0, 0);
    grain = c.toDataURL("image/png");
  } catch {
    grain = null;
  }
  return grain;
}

/**
 * How big `ref` is (px), following it as it resizes. Measured before the first paint, so a phone never shows a frame of
 * the wide sky (and the house drawn for it) first.
 */
export function useSize(ref: RefObject<HTMLElement | null>): { w: number; h: number } {
  // A first guess from the window, so a phone's first draw is already a phone's (it's measured before it's shown).
  const [size, setSize] = useState(() => ({
    w: typeof window !== "undefined" && window.innerWidth < 640 ? window.innerWidth - 32 : 1100,
    h: 300,
  }));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = (w: number, h: number) => setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    fit(el.clientWidth, el.clientHeight);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => fit(Math.round(e.contentRect.width), Math.round(e.contentRect.height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** Two layers of stars twinkling out of step, faded by daylight and cloud. */
const Stars = memo(function Stars({ opacity }: { opacity: number }) {
  return (
    <div className="sky-fade absolute inset-0" style={{ opacity }}>
      <div className="sky-twinkle" style={{ backgroundImage: STARS_A }} />
      <div className="sky-twinkle" style={{ animationDelay: "-1.8s", backgroundImage: STARS_B }} />
    </div>
  );
});
const dots = (pts: [number, number, number][]) =>
  pts.map(([x, y, r]) => `radial-gradient(${r}px ${r}px at ${x}% ${y}%, #fff, transparent)`).join(", ");
const STARS_A = dots([
  [8, 14, 1],
  [31, 9, 1.5],
  [58, 7, 1],
  [81, 13, 1],
  [13, 47, 1],
  [66, 41, 1],
  [37, 52, 1],
]);
const STARS_B = dots([
  [19, 32, 1],
  [44, 24, 1],
  [69, 29, 1.5],
  [92, 35, 1],
  [52, 42, 1],
  [76, 49, 1],
  [25, 6, 1],
  [88, 21, 1],
]);

/** Whether `ref` is on screen, so what moves in it can stop while it's scrolled away. */
export function useOnScreen(ref: RefObject<HTMLElement | null>): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return on;
}
