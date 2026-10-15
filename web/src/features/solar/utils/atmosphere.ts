import { clamp01, css, cssA, mix, rgb, standardHour, type Rgb, type SkyWeather } from "~/features/solar/utils/sky";

/*
 * The Solar sky's look ("Atmosphere"): no drawn clouds, the weather felt as light and colour. A base gradient for the
 * time of day, five soft colour fields drifting over it (one warm field riding with the sun or moon), a luminous sun
 * or a crisp moon, wide fog bands when it's cloudy, fine light streaks when it rains, a faint aurora on clear nights.
 * Pure maths: it says what to paint at a moment, and SolarSky paints it.
 *
 * Everything is a gradient: no blur filters, masks or blend modes, which Safari (iOS above all) draws slowly and, in
 * layers that move, clips into hard straight lines at their edges.
 */

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** The sky (top, middle, horizon) at hours of the standard day (see standardHour). */
const SKY: [number, string, string, string][] = [
  [0, "#04060d", "#0a1024", "#0e1530"],
  [4.8, "#060914", "#151a3c", "#2c2350"],
  [5.7, "#111b40", "#4b3d70", "#d27a58"],
  [7.2, "#163a74", "#3c6eab", "#9dc1dc"],
  [12, "#0f3d7d", "#2e6aae", "#80b3de"],
  [15.6, "#1a447e", "#4a72a6", "#d8b484"],
  [17.4, "#24295b", "#7b4f78", "#f2985a"],
  [18.4, "#141a3d", "#3c2a52", "#a9566a"],
  [19.4, "#070b1a", "#10163a", "#1b2249"],
  [24, "#04060d", "#0a1024", "#0e1530"],
];

/** The colour fields through the standard day: a cool field, the warm one that rides with the light, a far field, a low glow. */
const FIELD: [number, string, string, string, string][] = [
  [0, "#0e1846", "#1a1446", "#0a283a", "#141a3c"],
  [4.8, "#141a4c", "#3a2458", "#1a2a52", "#4a2a52"],
  [5.7, "#2c3c80", "#ff9a6a", "#7a5aa6", "#ffb08a"],
  [7.2, "#3f80d4", "#ffd6a2", "#8fd2ea", "#d2e8f4"],
  [12, "#2a70d8", "#fff0c6", "#5ec8ea", "#a6dcf6"],
  [15.6, "#3468c4", "#ffd596", "#80b8e2", "#f2d2a0"],
  [17.4, "#3a3a8e", "#ff8a3c", "#e2607c", "#ffb26a"],
  [18.4, "#24205c", "#c8506c", "#5a3a8c", "#e07a6a"],
  [19.4, "#0f1644", "#1c164a", "#0c263a", "#161b3e"],
  [24, "#0e1846", "#1a1446", "#0a283a", "#141a3c"],
];

function stops(T: [number, ...string[]][], t: number): Rgb[] {
  let i = 0;
  while (i < T.length - 2 && T[i + 1][0] <= t) i++;
  const a = T[i];
  const b = T[i + 1];
  const k = clamp01((t - a[0]) / (b[0] - a[0]));
  const out: Rgb[] = [];
  for (let j = 1; j < a.length; j++) out.push(mix(rgb(a[j] as string), rgb(b[j] as string), k));
  return out;
}

/** Weather felt as colour: cloud greys and lifts a colour, rain cools and darkens it, a storm darkens it again. */
function weathered(c: Rgb, w: SkyWeather, day: number): Rgb {
  const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  c = mix(c, [l * 0.97, l * 0.99, l * 1.05], w.cover * 0.72);
  c = mix(c, mix([24, 28, 38], [168, 176, 188], day), w.cover * 0.28);
  c = mix(c, mix([10, 14, 24], [52, 64, 86], day), w.rain * 0.45);
  c = mix(c, [16, 18, 24], w.storm * 0.5);
  return c.map((v) => Math.max(0, Math.min(255, v))) as Rgb;
}

// Radial falloffs, [distance 0 to 1, strength]: shared by the gradients and the contrast check, so they agree.
type Profile = [number, number][];
const PF: Profile = [
  [0, 1],
  [0.2, 0.9],
  [0.4, 0.66],
  [0.6, 0.36],
  [0.8, 0.11],
  [1, 0],
];
const PB: Profile = [
  [0, 1],
  [0.08, 0.82],
  [0.2, 0.5],
  [0.4, 0.22],
  [0.7, 0.06],
  [1, 0],
];
const PG: Profile = [
  [0, 1],
  [0.3, 0.7],
  [0.6, 0.25],
  [1, 0],
];
const PH: Profile = [
  [0, 1],
  [0.15, 0.6],
  [0.4, 0.22],
  [0.7, 0.06],
  [1, 0],
];

const radial = (c: Rgb, a: number, P: Profile) =>
  `radial-gradient(closest-side, ${P.map(([d, s]) => `${cssA(c, a * s)} ${Math.round(d * 100)}%`).join(", ")})`;

function profile(P: Profile, d: number): number {
  if (d >= 1) return 0;
  for (let i = 1; i < P.length; i++)
    if (d <= P[i][0]) return lerp(P[i - 1][1], P[i][1], (d - P[i - 1][0]) / (P[i][0] - P[i - 1][0]));
  return 0;
}

const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const lum = (c: Rgb) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const contrast = (a: Rgb, b: Rgb) => {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** Fog bands: centre (of the sky's height), half height, seconds to sway, swaying the other way, strength. */
const FOG: [number, number, number, boolean, number][] = [
  [0.2, 0.2, 58, false, 0.75],
  [0.42, 0.22, 46, true, 1],
  [0.6, 0.2, 64, false, 0.9],
  [0.8, 0.24, 52, true, 0.85],
];

/**
 * Where the sun and moon are at `h` (hours since midnight), as fractions of the sky across and down, and how high each
 * is on its arc (`es`, `em`: 1 at the top, below 0 once it's set). The arcs are lower and eased compared with a real
 * sky, so the orb never passes behind the title and the low golden-hour sun still clears the fade into the card, then
 * sets into it. Cheap, so it's worked out on every frame while the rest of the sky only changes every few minutes.
 */
export function orbits(h: number, rise: number, set: number) {
  const xs = (h - rise) / (set - rise);
  const es = Math.sin(Math.PI * xs);
  const night = 24 - (set - rise);
  const xm = h >= set ? (h - set) / night : h < rise ? (h + 24 - set) / night : -1;
  const em = xm >= 0 && xm <= 1 ? Math.sin(Math.PI * xm) : -0.5;
  const lift = (e: number) => (e > 0 ? 94 - 52 * Math.pow(e, 0.45) : 94 - e * 80) / 100;
  return { es, em, sun: { x: 0.06 + xs * 0.88, y: lift(es) }, moon: { x: 0.06 + xm * 0.88, y: lift(em) } };
}

/** A box placed by its centre and half sizes, as fractions of the sky. */
export type Spot = { cx: number; cy: number; rx: number; ry: number };
export type Field = Spot & { background: string; drift: "a" | "b" | "c"; secs: number; reverse: boolean };

export type Atmosphere = {
  /** The base gradient, top to bottom. */
  base: string;
  aurora: Field[];
  fields: Field[];
  sun: { bloom: string; bloomScale: number; glow: string; core: string; coreOpacity: number };
  moon: { halo: string; haloScale: number; ringOpacity: number; coreOpacity: number };
  stars: number;
  fog: { opacity: number; bands: { cy: number; ry: number; background: string; secs: number; reverse: boolean }[] };
  rain: number;
  storm: number;
  /** The dark wash behind the title and its strength, and the weather chip's background. */
  wash: string;
  chip: string;
};

/** The sky's size and the places of its words, in px, for the wash to keep them readable. */
export type SkyFrame = { W: number; H: number; phone: boolean; story: string };

/** The orbs' sizes (px) on a phone and wider. */
export const ORBS = {
  phone: { bloom: 340, glow: 96, core: 30, halo: 180, ring: 104, moon: 15 },
  wide: { bloom: 600, glow: 150, core: 44, halo: 260, ring: 150, moon: 20 },
};

/**
 * The sky at a moment. `h` is hours since midnight, `rise` and `set` the sun's (hours), `w` the weather then.
 */
export function atmosphere(h: number, rise: number, set: number, w: SkyWeather, frame: SkyFrame): Atmosphere {
  const { W, H, phone } = frame;
  const std = standardHour(h, rise, set);
  const {
    es,
    em,
    sun: { x: sX, y: sY },
    moon: { x: mX, y: mY },
  } = orbits(h, rise, set);
  const day = clamp01(es * 4 + 0.35);
  const dark = clamp01(-es * 3);

  const base = stops(SKY, std).map((c) => weathered(c, w, day));
  base.push(mix(base[2], [20, 20, 22], 0.4));
  const F = stops(FIELD, std).map((c) => weathered(c, w, day));

  // What the sky can put behind the words at its brightest, for the wash (ellipses in px).
  type Ell = {
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    col: Rgb;
    a: number;
    p: Profile;
    slack: number;
    band?: boolean;
  };
  const ells: Ell[] = [];
  const keep = (s: Spot, col: Rgb, a: number, p: Profile, slack: number, band = false) =>
    ells.push({ cx: s.cx * W, cy: s.cy * H, rx: s.rx * W, ry: s.ry * H, col, a, p, slack, band });

  // The aurora: a faint colour drift on dark, clear nights.
  const auA = dark * (1 - 0.6 * w.cover) * (1 - 0.5 * w.rain);
  const aurora: Field[] = [];
  if (auA > 0.005)
    (
      [
        [0.34, 0.2, 0.72, 0.2, [64, 228, 184], 0.26, 31, false],
        [0.7, 0.34, 0.6, 0.18, [150, 104, 255], 0.22, 39, true],
      ] as const
    ).forEach(([cx, cy, rx, ry, c, a, secs, reverse]) => {
      const col = weathered([...c] as Rgb, w, 0);
      aurora.push({ cx, cy, rx, ry, background: radial(col, a * auA, PF), drift: "a", secs, reverse });
      keep({ cx, cy, rx, ry: ry * 1.4 }, col, a * auA, PF, 0.2);
    });

  // The mesh: five soft fields, the warm one riding with the light (the sun by day, the moon by night).
  const lw = clamp01((es + 0.15) / 0.3);
  const lx = Math.min(1.1, Math.max(-0.1, lerp(mX, sX, lw)));
  const ly = Math.min(1.05, lerp(mY, sY, lw) + 0.06);
  const fa = 1 - 0.25 * w.cover;
  const fields: Field[] = (
    [
      [0.1, 0, 0.5, 1.05, F[0], 0.72, "a", 38, false],
      [Math.min(0.95, 1 - lx * 0.7), 0.18, 0.45, 1, F[2], 0.6, "b", 44, false],
      [0.18, 0.95, 0.45, 0.75, mix(F[2], F[3], 0.5), 0.5, "c", 52, true],
      [0.55, 1, 0.8, 0.55, F[3], 0.46, "b", 60, true],
      [lx, ly, 0.42, 1, F[1], lerp(0.55, 0.72, lw), "c", 34, false],
    ] as const
  ).map(([cx, cy, rx, ry, col, a, drift, secs, reverse]) => {
    keep({ cx, cy, rx, ry }, col, a * fa, PF, 0.15);
    return { cx, cy, rx, ry, background: radial(col, a * fa, PF), drift, secs, reverse };
  });

  // The sun: a luminous orb with a wide bloom whose colour follows its height.
  const G = phone ? ORBS.phone : ORBS.wide;
  const low = clamp01(1 - es * 2.6);
  const sunCol = mix(mix(rgb("#fffaf0"), rgb("#ffb070"), low), rgb("#ff7a50"), clamp01(1 - es * 8));
  let bloomCol = mix(rgb("#ffe8ba"), rgb("#ff9650"), clamp01(1 - es * 2.2));
  bloomCol = mix(bloomCol, [236, 236, 240], w.cover * 0.55);
  bloomCol = mix(bloomCol, [196, 208, 232], w.rain * 0.5);
  const sunVis = clamp01(es * 5 + 0.5);
  const bloomA = sunVis * (0.6 - 0.18 * w.cover - 0.18 * w.rain);
  const glowA = sunVis * (0.85 - 0.35 * w.cover - 0.3 * w.rain);
  const coreA = sunVis * (1 - 0.45 * w.cover - 0.4 * w.rain);
  const bloomScale = 1 + 0.45 * w.cover;
  const edge = Math.round(62 - 26 * w.cover);
  const glowCol = mix(sunCol, bloomCol, 0.3);
  if (bloomA > 0.002) {
    const at = (r: number) => ({ cx: sX, cy: sY, rx: r / W, ry: r / H });
    keep(at((G.bloom / 2) * bloomScale * 1.04), bloomCol, bloomA, PB, 0.02);
    keep(at(G.glow / 2), glowCol, glowA, PG, 0);
    keep(
      at(G.core / 2),
      sunCol,
      coreA,
      [
        [0, 1],
        [edge / 100, 1],
        [1, 0],
      ],
      0,
    );
  }

  // The moon: a cool, crisp small orb with a soft halo and a faint ring.
  const moonVis = (1 - day) * clamp01(em * 4 + 0.4);
  const haloCol = mix([172, 192, 255], [184, 190, 204], w.cover);
  const haloA = moonVis * (0.5 - 0.2 * w.cover);
  const haloScale = 1 + 0.6 * w.cover;
  if (haloA > 0.002)
    keep(
      { cx: mX, cy: mY, rx: ((G.halo / 2) * haloScale) / W, ry: ((G.halo / 2) * haloScale) / H },
      haloCol,
      haloA,
      PH,
      0,
    );

  // Fog: slow, wide bands that cross and veil the orb.
  const fogO = clamp01((w.cover - 0.3) / 0.45);
  let fogCol = mix(mix(base[1], [228, 231, 236], 0.55), [40, 46, 60], 1 - day);
  fogCol = mix(fogCol, mix([16, 20, 30], [104, 114, 132], day), w.rain * 0.55);
  const fogA = lerp(0.6, 0.5, day);
  const bands =
    fogO > 0.005
      ? FOG.map(([cy, ry, secs, reverse, s]) => {
          keep({ cx: 0.5, cy, rx: 0.8, ry }, fogCol, fogA * s * fogO, PF, 0, true);
          return { cy, ry, background: radial(fogCol, fogA * s, PF), secs, reverse };
        })
      : [];

  // Rain: a faint sheen of light over everything, for the wash's sake.
  const rain = clamp01(w.rain / 0.5) * lerp(0.7, 1, day);
  if (rain > 0)
    ells.push({
      cx: 0,
      cy: 0,
      rx: 1e9,
      ry: 1e9,
      col: [255, 255, 255],
      a: 0.09 * rain,
      p: [
        [0, 1],
        [1, 1],
      ],
      slack: 0,
      band: true,
    });

  // The title's wash: a deeper tone of the sky's own top colour, only as strong as the brightest sky behind the words
  // needs (the subtitle at 4.5:1, the title at 3:1), so it reads as the sky deepening rather than a dark patch.
  const sampleSky = (x: number, y: number): Rgb => {
    const k = clamp01(y / H);
    let c =
      k < 0.5
        ? mix(base[0], base[1], k / 0.5)
        : k < 0.8
          ? mix(base[1], base[2], (k - 0.5) / 0.3)
          : mix(base[2], base[3], (k - 0.8) / 0.2);
    for (const e of ells) {
      const dx = (x - e.cx) / e.rx;
      const dy = (y - e.cy) / e.ry;
      const d = e.band ? Math.abs(dy) : Math.sqrt(dx * dx + dy * dy);
      const c1 = mix(c, e.col, Math.min(1, e.a * profile(e.p, Math.max(0, d - e.slack))));
      const c2 = mix(c, e.col, Math.min(1, e.a * profile(e.p, d + e.slack)));
      c = lum(c1) >= lum(c2) ? c1 : c2;
    }
    return c;
  };
  const washAt = (x: number, y: number) => {
    if (phone)
      return y <= 92 ? 1 : y <= 126 ? lerp(1, 0.5, (y - 92) / 34) : y <= 170 ? lerp(0.5, 0, (y - 126) / 44) : 0;
    const d = Math.sqrt(Math.pow(x / 640, 2) + Math.pow(y / 220, 2));
    return d <= 0.5 ? 1 : d <= 0.75 ? lerp(1, 0.55, (d - 0.5) / 0.25) : d < 1 ? lerp(0.55, 0, (d - 0.75) / 0.25) : 0;
  };
  const wc = mix(base[0], [3, 5, 12], 0.72);
  const needed = (bg: Rgb, f: number, alphaText: number, need: number) => {
    const ok = (a: number) => {
      const b = mix(bg, wc, a * f);
      return contrast(mix(b, [255, 255, 255], alphaText), b) >= need;
    };
    if (ok(0)) return 0;
    if (f <= 0.02 || !ok(1)) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 12; i++) {
      const m = (lo + hi) / 2;
      if (ok(m)) hi = m;
      else lo = m;
    }
    return hi;
  };
  const B = phone
    ? { tx: 20, ty: 18, tw: 76, th: 36, sy: 58, sh: 22, smax: Math.max(120, W - 40), chipW: 214, chipY: 19, chipH: 34 }
    : { tx: 28, ty: 26, tw: 104, th: 46, sy: 74, sh: 22, smax: 600, chipW: 228, chipY: 22, chipH: 36 };
  const sw = Math.min(B.smax, frame.story.length * 8.2);
  const lines = frame.story.length * 8.2 > B.smax ? 2 : 1;
  const grid = (x0: number, x1: number, y0: number, y1: number, fn: (x: number, y: number) => void) => {
    for (let i = 0; i <= 6; i++) for (let j = 0; j <= 2; j++) fn(lerp(x0, x1, i / 6), lerp(y0, y1, j / 2));
  };
  let need = 0;
  grid(B.tx, B.tx + B.tw, B.ty + 6, B.ty + B.th - 6, (x, y) => {
    need = Math.max(need, needed(sampleSky(x, y), washAt(x, y), 1, 3.15));
  });
  grid(B.tx, B.tx + sw, B.sy + 3, B.sy + B.sh * lines - 3, (x, y) => {
    need = Math.max(need, needed(sampleSky(x, y), washAt(x, y), 0.9, 4.7));
  });
  const washA = Math.min(0.86, Math.max(0.16, need));
  let chipA = 0;
  // From tablets up the live clock and account sit to its right.
  const cx1 = W - (phone ? 20 : 252);
  grid(cx1 - B.chipW, cx1, B.chipY + 4, B.chipY + B.chipH - 4, (x, y) => {
    const bg = mix(sampleSky(x, y), wc, washA * washAt(x, y));
    chipA = Math.max(chipA, needed(bg, 1, 0.96, 4.7));
  });
  chipA = Math.min(0.86, Math.max(0.3, chipA));
  const wash = phone
    ? `linear-gradient(180deg, ${cssA(wc, washA)} 0px, ${cssA(wc, washA)} 92px, ${cssA(wc, washA * 0.5)} 126px, ${cssA(wc, 0)} 170px)`
    : `radial-gradient(640px 220px at 0 0, ${cssA(wc, washA)} 0%, ${cssA(wc, washA)} 50%, ${cssA(wc, washA * 0.55)} 75%, ${cssA(wc, 0)} 100%)`;

  return {
    base: `linear-gradient(180deg, ${css(base[0])} 0%, ${css(base[1])} 50%, ${css(base[2])} 80%, ${css(base[3])} 100%)`,
    aurora,
    fields,
    sun: {
      bloom: radial(bloomCol, bloomA, PB),
      bloomScale,
      glow: radial(glowCol, glowA, PG),
      core: `radial-gradient(closest-side, #fffefa 0%, ${css(sunCol)} 38%, ${css(sunCol)} ${edge}%, ${cssA(sunCol, 0)} 100%)`,
      coreOpacity: coreA,
    },
    moon: {
      halo: radial(haloCol, haloA, PH),
      haloScale,
      ringOpacity: moonVis * clamp01(0.8 - 0.7 * w.cover),
      coreOpacity: moonVis * (1 - 0.7 * w.cover),
    },
    stars: clamp01(-es * 4) * clamp01(1 - w.cover * 1.15) * 0.95,
    fog: { opacity: fogO, bands },
    rain,
    storm: clamp01((w.storm - 0.2) / 0.6),
    wash,
    chip: cssA(wc, chipA),
  };
}
