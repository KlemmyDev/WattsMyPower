import { Fragment, useMemo } from "react";
import type { Cover, SkyMode } from "~/features/common/weather/utils";
import { box, dPath, FLOW, group, h, I, ln, poly, sag, type Kid } from "~/features/overview/utils/house/iso";
import {
  DEFAULT_HOUSE,
  fitted,
  layoutFor,
  type HouseOptions,
  type Layout,
  type Unit,
} from "~/features/overview/utils/house/layout";
import { scenery } from "~/features/overview/utils/house/scenery";
import { sky as drawSky } from "~/features/overview/utils/house/sky";

/*
 * Isometric house for the Power flow card, ported from the design's houseSvg.
 *   flows holds values in kW: pv, grid (+ importing), bat (+ charging), soc (0..1), tesla, conn, and
 *     optionally each inverter's share of the solar (pvEach)
 *   house is how it's built (Settings → System → Your house): storeys, garage, batteries and inverters
 *   sky is the weather: "sunny" | "cloudy" | "rain" | "storm" | "night"
 *   cover is the weather at night: "clear" | "cloudy" | "rain" | "storm"
 * houseAnchors() gives {left, top} percentages for the HTML label pills.
 */

export type HouseFlows = {
  pv: number;
  grid: number;
  bat: number;
  soc: number;
  tesla: number;
  conn: boolean;
  /** Each inverter's solar, when known (the hybrid's and a second inverter's); otherwise pv is shared out. */
  pvEach?: number[];
};

// Energy line: a faint track, and when power flows a tinted line with travelling "comets".
function flow(d: string, v: number, forward: boolean, color: string, night: boolean) {
  const kw = Math.abs(v);
  const on = kw > 0.05;
  const du = Math.max(1.1, 3.2 - Math.round(kw) * 0.25);
  const comet = (delay: string) =>
    h("path", {
      d,
      pathLength: 100,
      fill: "none",
      stroke: color,
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeDasharray: "7 93",
      style: {
        animation: `wmpComet ${du.toFixed(2)}s cubic-bezier(0.45,0,0.55,1) ${delay} infinite ${forward ? "normal" : "reverse"}`,
      },
    });
  return h(
    "g",
    {},
    h("path", {
      d,
      fill: "none",
      stroke: night ? "rgba(255,255,255,0.22)" : "rgba(17,17,17,0.16)",
      strokeWidth: 1.5,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    }),
    on &&
      h("path", {
        d,
        fill: "none",
        stroke: color,
        strokeOpacity: 0.28,
        strokeWidth: 1.5,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      }),
    on && comet("0s"),
    on && kw > 2.5 && comet(`-${(du / 2).toFixed(2)}s`),
  );
}

const mid = (u: Unit) => (u.y0 + u.y1) / 2;

// A battery's case, with a little terminal on top.
const batteryCase = (u: Unit) =>
  group(
    box(u.x, u.x + 0.32, u.y0, u.y1, u.z0, u.z1, "#ffffff", "#fafafa", "#e1e1e1"),
    ln([u.x + 0.33, u.y1 - 0.2, u.z1 - 0.35], [u.x + 0.33, u.y1 - 0.2, u.z1 - 0.2], {
      stroke: "#c9ccd2",
      strokeWidth: 2,
    }),
  );

// Battery charge gauge on a battery's case: 10 segments, the next one pulses while charging.
function gauge(u: Unit, f: HouseFlows) {
  const out: Kid[] = [];
  const seg = 10;
  const filled = Math.round(f.soc * seg);
  const charging = f.bat > 0.05;
  const step = (u.z1 - u.z0 - 0.5) / seg;
  const half = Math.min(0.2, (u.y1 - u.y0) / 5);
  for (let k = 0; k < seg; k++) {
    const z0 = u.z0 + 0.32 + k * step;
    const z1 = z0 + step * 0.78;
    const on = k < filled;
    const next = charging && k === filled;
    out.push(
      poly(
        [
          [u.x + 0.33, mid(u) - half, z0],
          [u.x + 0.33, mid(u) + half, z0],
          [u.x + 0.33, mid(u) + half, z1],
          [u.x + 0.33, mid(u) - half, z1],
        ],
        on ? FLOW.bat : next ? "#8fa6ff" : "#e6e7ea",
        next ? { style: { animation: "wmpPulse 1.4s ease-in-out infinite" } } : {},
      ),
    );
  }
  return group(out);
}

const inverterCase = (u: Unit) => group(box(u.x, u.x + 0.22, u.y0, u.y1, u.z0, u.z1, "#ffffff", "#f3f3f3", "#dddddd"));

// An inverter's light: lit while its panels make power.
const invLed = (u: Unit, on: boolean, r: number) => {
  const d = I(u.x + 0.23, u.y0 + 0.25, u.z1 - 0.25);
  return h("circle", { cx: d[0], cy: d[1], r, fill: on ? FLOW.pv : "#c4c7cc" });
};

/** Each inverter's solar: as measured where it's known, else the total shared out evenly. */
function pvEach(f: HouseFlows, n: number): number[] {
  if (f.pvEach && f.pvEach.length === n) return f.pvEach;
  const known = (f.pvEach ?? []).slice(0, n);
  const rest = Math.max(f.pv - known.reduce((a, v) => a + v, 0), 0);
  return [...known, ...Array(n - known.length).fill(rest / Math.max(n - known.length, 1))];
}

type LabelKey = "solar" | "grid" | "home" | "battery" | "tesla";
const LEADER_COLOR: Record<LabelKey, string> = {
  solar: FLOW.pv,
  grid: "#3a3d44",
  home: "#111111",
  battery: FLOW.bat,
  tesla: FLOW.car,
};

// Where each label pill's leader line starts (the pills sit at the card's left and right edges). The point
// on the drawing it ends at comes from the house's layout. The scene spans x -200..1000.
const LBL: Record<LabelKey, [number, number]> = {
  solar: [760, 185],
  grid: [-20, 380],
  home: [-20, 485],
  battery: [760, 320],
  tesla: [760, 470],
};

export type Anchor = { left: string; top: string };
const px = (p: [number, number]): Anchor => ({
  left: (((p[0] + 200) / 1200) * 100).toFixed(2) + "%",
  top: ((p[1] / 600) * 100).toFixed(2) + "%",
});

const ANCHORS = {
  labels: Object.fromEntries(Object.entries(LBL).map(([k, lp]) => [k, px(lp)])) as Record<LabelKey, Anchor>,
};

/** Positions (percent of the scene) for the label pills. */
export const houseAnchors = () => ANCHORS;

export function HouseScene({
  flows,
  sky,
  cover = "clear",
  house = DEFAULT_HOUSE,
  leaders = true,
}: {
  flows: HouseFlows;
  sky: SkyMode;
  cover?: Cover;
  house?: HouseOptions;
  /** Lines out to the label pills (the Overview has them; a preview doesn't). */
  leaders?: boolean;
}) {
  const l: Layout = layoutFor(house);
  const S = scenery(l);
  const sk = useMemo(() => drawSky(sky, cover), [sky, cover]);
  const night = sky === "night";
  const wetGround = sky === "rain" || sky === "storm" || (night && (cover === "rain" || cover === "storm"));
  const solar = pvEach(flows, l.inverters.length);
  const ch = l.charger;
  const chLed = I(ch.x + 0.15, mid(ch), ch.z1 - 0.2);
  const inside = (u: Unit) => l.ghostGarage && u.x === 10 && !!l.garage;
  const equipment = (where: (u: Unit) => boolean, glow = false) =>
    group(
      // Back to front along the wall, so nearer cases cover farther ones.
      [...l.inverters.map((u, i) => ({ u, i, inv: true })), ...l.batteries.map((u, i) => ({ u, i, inv: false }))]
        .filter(({ u }) => where(u))
        .sort((a, b) => a.u.y0 - b.u.y0)
        .map(({ u, i, inv }) =>
          inv
            ? group(!glow && inverterCase(u), invLed(u, solar[i] > 0.05, glow ? 2.2 : 2))
            : group(!glow && batteryCase(u), gauge(u, flows)),
        ),
    );
  const { scale, dx, dy } = l.fit;

  return (
    // "slice" so a narrower frame (phones use 4:3) crops the empty sky at the sides rather than shrinking the house.
    <svg
      viewBox="-200 0 1200 600"
      preserveAspectRatio="xMidYMid slice"
      className="house-scene absolute inset-0 size-full overflow-hidden"
      aria-hidden="true"
    >
      {sk.back}
      <g
        transform={scale === 1 ? undefined : `translate(${dx.toFixed(1)} ${dy.toFixed(1)}) scale(${scale.toFixed(4)})`}
      >
        {S.ground}
        {wetGround && S.wet}
        {S.house}
        {S.garageInside}
        {equipment(inside)}
        {S.garageShell}
        {S.roof}
        {equipment((u) => !inside(u))}
        {group(box(ch.x, ch.x + 0.14, ch.y0, ch.y1, ch.z0, ch.z1, "#fafafa", "#f1f1f1", "#d9d9d9"))}
        {S.yard}
        {h("circle", { cx: chLed[0], cy: chLed[1], r: 1.8, fill: flows.conn ? FLOW.car : "#bbbbbb" })}
        {!flows.conn && S.parking}
      </g>
      {night &&
        h("rect", {
          x: -204,
          y: -4,
          width: 1208,
          height: 608,
          fill: "#16203a",
          fillOpacity: 0.55,
          style: { mixBlendMode: "multiply" },
        })}
      <g
        transform={scale === 1 ? undefined : `translate(${dx.toFixed(1)} ${dy.toFixed(1)}) scale(${scale.toFixed(4)})`}
      >
        {night && S.night}
        {night && equipment(() => true, true)}
        {/* pole to house */}
        {flow(sag([-1.5, 8.9, 7.6], l.shape.gridAt, 34), flows.grid, flows.grid > 0, FLOW.grid, night)}
        {/* roof to each inverter */}
        {l.pvPaths.map((path, i) => (
          <Fragment key={i}>{flow(dPath(path), solar[i], true, FLOW.pv, night)}</Fragment>
        ))}
        {/* main inverter to each battery */}
        {l.batteryPaths.map((path, i) => (
          <Fragment key={i}>{flow(dPath(path), flows.bat, flows.bat > 0, FLOW.bat, night)}</Fragment>
        ))}
      </g>
      {sk.front}
      <g className="leaders">
        {(Object.keys(LBL) as LabelKey[])
          .filter(() => leaders)
          .filter((k) => k !== "tesla" || flows.conn)
          .map((k) => {
            const lp = LBL[k];
            const an = fitted(l, l.anchors[k]);
            const lc = LEADER_COLOR[k];
            return (
              <Fragment key={k}>
                {h("line", {
                  className: "ld",
                  x1: lp[0],
                  y1: lp[1],
                  x2: an[0],
                  y2: an[1],
                  stroke: night ? "#ffffff" : "#111111",
                  strokeOpacity: 0.35,
                  strokeWidth: 1,
                })}
                {h("circle", { cx: an[0], cy: an[1], r: 7, fill: lc, fillOpacity: 0.18 })}
                {h("circle", { cx: an[0], cy: an[1], r: 3.5, fill: lc, stroke: "#ffffff", strokeWidth: 1.5 })}
              </Fragment>
            );
          })}
      </g>
    </svg>
  );
}
