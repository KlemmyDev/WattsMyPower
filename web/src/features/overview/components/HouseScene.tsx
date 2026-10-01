import { Fragment, useMemo } from "react";
import type { Cover, SkyMode } from "~/features/common/weather/utils";
import { dPath, FLOW, group, h, I, ln, poly, sag, type Kid } from "~/features/overview/utils/house/iso";
import { scenery } from "~/features/overview/utils/house/scenery";
import { sky as drawSky } from "~/features/overview/utils/house/sky";

/*
 * Isometric house for the Power flow card, ported from the design's houseSvg.
 *   flows holds values in kW: pv, grid (+ importing), bat (+ charging), soc (0..1), tesla, conn
 *   sky is the weather: "sunny" | "cloudy" | "rain" | "storm" | "night"
 *   cover is the weather at night: "clear" | "cloudy" | "rain" | "storm"
 * houseAnchors() gives {left, top} percentages for the HTML label pills.
 */

export type HouseFlows = { pv: number; grid: number; bat: number; soc: number; tesla: number; conn: boolean };

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

// Battery charge gauge on the battery case: 10 segments, the next one pulses while charging.
function gauge(f: HouseFlows) {
  const out: Kid[] = [];
  const seg = 10;
  const filled = Math.round(f.soc * seg);
  const charging = f.bat > 0.05;
  for (let k = 0; k < seg; k++) {
    const z0 = 0.62 + k * 0.205;
    const z1 = z0 + 0.16;
    const on = k < filled;
    const next = charging && k === filled;
    out.push(
      poly(
        [
          [10.33, 4.3, z0],
          [10.33, 4.7, z0],
          [10.33, 4.7, z1],
          [10.33, 4.3, z1],
        ],
        on ? FLOW.bat : next ? "#8fa6ff" : "#e6e7ea",
        next ? { style: { animation: "wmpPulse 1.4s ease-in-out infinite" } } : {},
      ),
    );
  }
  return group(out);
}

const invLed = (r: number) => {
  const d = I(10.23, 5.85, 3.15);
  return h("circle", { cx: d[0], cy: d[1], r, fill: FLOW.pv });
};

type LabelKey = "solar" | "grid" | "home" | "battery" | "tesla";
const LEADER_COLOR: Record<LabelKey, string> = {
  solar: FLOW.pv,
  grid: "#3a3d44",
  home: "#111111",
  battery: FLOW.bat,
  tesla: FLOW.car,
};

// Where each label pill's leader line starts (the pills sit at the card's left and right edges),
// and the point on the drawing it points at. The scene spans x -200..1000.
const LBL: Record<LabelKey, [start: [number, number], anchor: [number, number]]> = {
  solar: [[760, 185], I(5, 6.2, 6.5)],
  grid: [[-20, 380], I(-1.5, 9.7, 8.2)],
  home: [[-20, 485], I(2.4, 8, 2.7)],
  battery: [[760, 320], I(10.33, 4.5, 1.8)],
  tesla: [[760, 470], I(13.95, 4.3, 1.0)],
};

export type Anchor = { left: string; top: string };
const px = (p: [number, number]): Anchor => ({
  left: (((p[0] + 200) / 1200) * 100).toFixed(2) + "%",
  top: ((p[1] / 600) * 100).toFixed(2) + "%",
});

const ANCHORS = {
  labels: Object.fromEntries(Object.entries(LBL).map(([k, [lp]]) => [k, px(lp)])) as Record<LabelKey, Anchor>,
};

/** Positions (percent of the scene) for the label pills. */
export const houseAnchors = () => ANCHORS;

export function HouseScene({ flows, sky, cover = "clear" }: { flows: HouseFlows; sky: SkyMode; cover?: Cover }) {
  const S = scenery();
  const sk = useMemo(() => drawSky(sky, cover), [sky, cover]);
  const night = sky === "night";
  const wetGround = sky === "rain" || sky === "storm" || (night && (cover === "rain" || cover === "storm"));
  const chLed = I(10.15, 7.2, 2.1);

  return (
    // "slice" so a narrower frame (phones use 4:3) crops the empty sky at the sides rather than shrinking the house.
    <svg
      viewBox="-200 0 1200 600"
      preserveAspectRatio="xMidYMid slice"
      className="house-scene absolute inset-0 size-full overflow-hidden"
      aria-hidden="true"
    >
      {sk.back}
      {S.ground}
      {wetGround && S.wet}
      {S.house}
      {S.front}
      {invLed(2)}
      {gauge(flows)}
      {ln([10.33, 4.9, 2.55], [10.33, 4.9, 2.7], { stroke: "#c9ccd2", strokeWidth: 2 })}
      {S.yard}
      {h("circle", { cx: chLed[0], cy: chLed[1], r: 1.8, fill: flows.conn ? FLOW.car : "#bbbbbb" })}
      {!flows.conn && S.parking}
      {night && S.night}
      {night && gauge(flows)}
      {night && invLed(2.2)}
      {/* pole to house */}
      {flow(sag([-1.5, 8.9, 7.6], [0.9, 8.03, 3.4], 34), flows.grid, flows.grid > 0, FLOW.grid, night)}
      {/* roof to inverter */}
      {flow(
        dPath([
          [9.2, 8.1, 4.95],
          [10.03, 7.7, 4.72],
          [10.03, 6.0, 4.72],
          [10.03, 6.0, 3.4],
        ]),
        flows.pv,
        true,
        FLOW.pv,
        night,
      )}
      {/* inverter to battery */}
      {flow(
        dPath([
          [10.03, 6.0, 2.4],
          [10.03, 6.0, 0.9],
          [10.03, 5.05, 0.9],
        ]),
        flows.bat,
        flows.bat > 0,
        FLOW.bat,
        night,
      )}
      {sk.front}
      <g className="leaders">
        {(Object.keys(LBL) as LabelKey[])
          .filter((k) => k !== "tesla" || flows.conn)
          .map((k) => {
            const [lp, an] = LBL[k];
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
