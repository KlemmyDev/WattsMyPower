import { useRouter } from "@tanstack/react-router";
import { Fragment, useMemo, useState, type MouseEvent } from "react";
import type { Cover, SkyMode } from "~/features/common/weather/utils";
import { drawCar, spotOutline, spotTop, type CarBody } from "~/features/overview/utils/house/cars";
import { box, dPath, FLOW, group, h, I, ln, poly, sag, type Kid, type P3 } from "~/features/overview/utils/house/iso";
import {
  DEFAULT_HOUSE,
  layoutFor,
  type HouseOptions,
  type Layout,
  type Spot,
  type Unit,
} from "~/features/overview/utils/house/layout";
import { scenery } from "~/features/overview/utils/house/scenery";
import { sky as drawSky } from "~/features/overview/utils/house/sky";

/*
 * Isometric house for the Power flow card, ported from the design's houseSvg.
 *   flows holds values in kW: pv, grid (+ importing), bat (+ charging), soc (0..1), tesla, conn, and
 *     optionally each inverter's share of the solar (pvEach)
 *   house is how it's built (Settings → Your house): storeys, garage, batteries and inverters
 *   sky is the weather: "sunny" | "cloudy" | "rain" | "storm" | "night"
 *   cover is the weather at night: "clear" | "cloudy" | "rain" | "storm"
 *   cars are the connected cars, in the order house.cars gives where each would rather park: each one's shape and
 *     paint, and for the Overview (with links), a label and where it links to
 */

/** A connected car, as the drawing needs it; `charging`: at home, from the charger. */
export type SceneCar = { body: CarBody; paint: string; label: string; href: string; charging?: boolean };

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

export function HouseScene({
  flows,
  sky,
  cover = "clear",
  house = DEFAULT_HOUSE,
  cars = [],
  links = false,
}: {
  flows: HouseFlows;
  sky: SkyMode;
  cover?: Cover;
  house?: HouseOptions;
  cars?: SceneCar[];
  /** Each parking spot links to its car, or to connecting one (the Overview). */
  links?: boolean;
}) {
  const l: Layout = layoutFor(house);
  const S = scenery(l);
  const sk = useMemo(() => drawSky(sky, cover), [sky, cover]);
  const night = sky === "night";
  const wetGround = sky === "rain" || sky === "storm" || (night && (cover === "rain" || cover === "storm"));
  const solar = pvEach(flows, l.inverters.length);
  const ch = l.charger;
  const chLed = I(ch.x + 0.15, mid(ch), ch.z1 - 0.2);
  const charger = group(box(ch.x, ch.x + 0.14, ch.y0, ch.y1, ch.z0, ch.z1, "#fafafa", "#f1f1f1", "#d9d9d9"));
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
  const fitG = scale === 1 ? undefined : `translate(${dx.toFixed(1)} ${dy.toFixed(1)}) scale(${scale.toFixed(4)})`;
  // Each spot's car (if one parks there), and the cars drawn nearest last: further right is nearer.
  const carIn = l.spots.map((_, k) => {
    const i = l.parked.indexOf(k);
    return i >= 0 ? cars[i] : undefined;
  });
  const parkedCars = (garage: boolean) =>
    group(
      l.spots.map((sp, k) => {
        const c = carIn[k];
        return sp.garage === garage && c ? drawCar(sp, c.body, c.paint) : null;
      }),
    );
  const emptyBays = group(
    l.spots.map((sp, k) =>
      !sp.garage && !carIn[k]
        ? poly(spotOutline(sp, 0.02), "none", {
            stroke: "rgba(0,0,0,0.28)",
            strokeWidth: 1.5,
            strokeDasharray: "6 6",
          })
        : null,
    ),
  );

  return (
    <>
      {/* "slice" so a narrower frame (phones use 4:3) crops the empty sky at the sides rather than shrinking the house. */}
      <svg
        viewBox="-200 0 1200 600"
        preserveAspectRatio="xMidYMid slice"
        className="house-scene absolute inset-0 size-full overflow-hidden"
        aria-hidden="true"
      >
        {sk.back}
        <g transform={fitG}>
          {S.ground}
          {wetGround && S.wet}
          {S.house}
          {S.garageInside}
          {equipment(inside)}
          {/* under a carport, the charger is too */}
          {inside(ch) && charger}
          {parkedCars(true)}
          {S.garageShell}
          {S.roof}
          {equipment((u) => !inside(u))}
          {!inside(ch) && charger}
          {S.yard}
          {/* the charger's light: lit, and breathing, while it charges a car */}
          {h("circle", {
            cx: chLed[0],
            cy: chLed[1],
            r: 1.8,
            fill: flows.conn ? FLOW.car : "#bbbbbb",
            style: flows.conn ? { animation: "wmpPulse 1.4s ease-in-out infinite" } : undefined,
          })}
          {emptyBays}
          {parkedCars(false)}
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
        <g transform={fitG}>
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
      </svg>
      {links && <SpotLinks l={l} cars={carIn} transform={fitG} night={night} />}
    </>
  );
}

/** The outline of a spot's car, standing on it: a hexagon around a box as tall as a car. */
function standing(sp: Spot): P3[] {
  const t = 1.7;
  return [
    [sp.x0, sp.y1, 0],
    [sp.x1, sp.y1, 0],
    [sp.x1, sp.y0, 0],
    [sp.x1, sp.y0, t],
    [sp.x0, sp.y0, t],
    [sp.x0, sp.y1, t],
  ];
}

/**
 * The parking spots as links, over the drawing (which is hidden from screen readers): a car's to its page, an empty
 * spot to connecting one. Hovering or focusing one outlines it and shows where it goes.
 */
function SpotLinks({
  l,
  cars,
  transform,
  night,
}: {
  l: Layout;
  cars: (SceneCar | undefined)[];
  transform: string | undefined;
  night: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState<number | null>(null);
  const go = (href: string) => (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    router.history.push(href);
  };
  const anyCar = cars.some(Boolean);
  return (
    <svg
      viewBox="-200 0 1200 600"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 size-full overflow-hidden"
      role="group"
      aria-label="Parking"
    >
      <g transform={transform}>
        {l.spots.map((sp, k) => {
          const c = cars[k];
          const label = c ? c.label : anyCar ? "Connect another EV" : "Connect your EV";
          const href = c ? c.href : "/integrations/ev";
          const lit = on === k;
          const [tx, ty] = spotTop(sp);
          const w = label.length * 6.6 + 34;
          return (
            <a
              key={k}
              href={href}
              aria-label={c ? `${c.label}: open it` : label}
              onClick={go(href)}
              onPointerEnter={() => setOn(k)}
              onPointerLeave={() => setOn((v) => (v === k ? null : v))}
              onFocus={() => setOn(k)}
              onBlur={() => setOn((v) => (v === k ? null : v))}
              className="cursor-pointer outline-none"
            >
              {poly(standing(sp), "transparent")}
              {lit &&
                poly(spotOutline(sp), night ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.35)", {
                  stroke: night ? "#ffffff" : "#111111",
                  strokeOpacity: 0.55,
                  strokeWidth: 1.5,
                  strokeDasharray: "5 4",
                  pointerEvents: "none",
                })}
              {lit && (
                <g pointerEvents="none" transform={`translate(${tx.toFixed(1)} ${(ty - 14).toFixed(1)})`}>
                  {h("rect", {
                    x: -w / 2,
                    y: -15,
                    width: w,
                    height: 30,
                    rx: 15,
                    fill: "#111111",
                    fillOpacity: 0.88,
                  })}
                  <text x={0} y={4.5} textAnchor="middle" fill="#ffffff" fontSize={13} fontWeight={600}>
                    {label} ›
                  </text>
                </g>
              )}
            </a>
          );
        })}
      </g>
    </svg>
  );
}
