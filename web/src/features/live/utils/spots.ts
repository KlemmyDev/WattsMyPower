import { lerp, lerp3, type Geometry, type Mount, type P3, type Pose } from "~/features/live/utils/house3d";

/*
 * Where each live page's camera sits, as Solar's always has: the eye, what it looks at, the lens, and where on the
 * picture that lands, wider and on a phone (a phone's picture is 600 wide, a wider one 1100; see FRAME). A page names
 * its spot; moving between pages flies the camera from one to the next (between()). EV, Grid and Home add theirs with
 * registerSpot().
 */

export type SpotFn = (g: Geometry, phone: boolean) => Pose;

const spots = new Map<string, SpotFn>();

/** Adds a page's camera spot (or replaces it). */
export function registerSpot(name: string, fn: SpotFn) {
  spots.set(name, fn);
}

/** The camera for a page's spot, for your house; Solar's for a page without one. */
export function spotPose(name: string, g: Geometry, phone: boolean): Pose {
  return (spots.get(name) ?? spots.get("solar")!)(g, phone);
}

/** A point by a mount's own directions: out from its wall `n`, along it `a`, and up. */
const rel = (M: Mount, n: number, a: number, z: number): P3 => [
  M.o[0] + M.n[0] * n + M.a[0] * a,
  M.o[1] + M.n[1] * n + M.a[1] * a,
  M.o[2] + z,
];

/** Solar: low on the front right corner, looking along the street side of the roof. Higher for two storeys. */
registerSpot("solar", (g, phone) => {
  const up = g.storeys === 2 ? 2.9 : 0;
  return phone
    ? { eye: [13.5, 12.5, 3.6 + up], at: [4, 5, 3.4 + up], fov: 55, cx: 300, cy: 285 }
    : { eye: [13.5, 12.5, 3.6 + up], at: [4, 5, 3.4 + up], fov: 55, cx: 520, cy: 300 };
});

/** Solar's first showing in a visit starts here, low on the wall and the garden, and tilts up to the roof. */
registerSpot("solar-intro", (g, phone) => {
  const up = g.storeys === 2 ? 2.9 : 0;
  return phone
    ? { eye: [13.5, 12.5, 2.4 + up / 2], at: [6, 7, 0.9 + up / 2], fov: 55, cx: 300, cy: 285 }
    : { eye: [13.5, 12.5, 2.4 + up / 2], at: [6, 7, 0.9 + up / 2], fov: 55, cx: 520, cy: 300 };
});

/** Battery: close on the battery and inverter, on the side wall (or the garage's), or inside the garage. */
registerSpot("battery", (g, phone) => {
  const M = g.mount;
  // In the garage: from just outside the door, a little to the left, looking in at the back wall (clear of a car).
  if (M.inside)
    return phone
      ? { eye: rel(M, 8.65, 0.2, 1.9), at: rel(M, 0.25, 0.85, 1.05), fov: 50, cx: 330, cy: 290 }
      : { eye: rel(M, 8.25, 0.2, 1.9), at: rel(M, 0.25, 0.85, 1.05), fov: 44, cx: 700, cy: 280 };
  return phone
    ? { eye: rel(M, 7.2, 8.65, 1.75), at: rel(M, 0.25, 0.95, 1.0), fov: 38, cx: 330, cy: 310 }
    : { eye: rel(M, 8.0, 9.25, 1.8), at: rel(M, 0.25, 0.9, 1.0), fov: 32, cx: 690, cy: 338 };
});

/** EV: on the driveway from out by the street, along the car's right side to its port; in the garage, from the
 * doorway's right-hand side looking in along it. */
registerSpot("ev", (g, phone) => {
  const C = g.car;
  if (C.inGarage) {
    const dx = (g.garage?.x1 ?? 15.2) - 15.2;
    return phone
      ? { eye: [14.55 + dx, 14.2, 2.0], at: [13.5 + dx, 4.9, 0.9], fov: 48, cx: 320, cy: 300 }
      : { eye: [14.55 + dx, 13.6, 2.0], at: [13.5 + dx, 4.9, 0.9], fov: 40, cx: 640, cy: 315 };
  }
  const dx = C.x0 - 11;
  return phone
    ? { eye: [20 + dx, 21, 2.3], at: [12 + dx, 11, 0.8], fov: 42, cx: 320, cy: 300 }
    : { eye: [20.8 + dx, 21.6, 2.4], at: [12 + dx, 11, 0.8], fov: 34, cx: 640, cy: 330 };
});

/** Grid: from across the street to the west, the poles and wires in front, the line to the house and its meter. */
registerSpot("grid", (_g, phone) =>
  phone
    ? { eye: [-8, 26, 2.0], at: [4, 10, 3.0], fov: 54, cx: 300, cy: 300 }
    : { eye: [-8.5, 26.5, 2.1], at: [4.5, 10, 3.0], fov: 46, cx: 580, cy: 320 },
);

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Part way along a flight: eased, and swung out from the house a little at its middle so it reads as a move. */
export function between(a: Pose, b: Pose, t: number): Pose {
  const e = easeInOut(t);
  const arc = Math.sin(Math.PI * e);
  const eye = lerp3(a.eye, b.eye, e);
  return {
    eye: [eye[0] + 0.9 * arc, eye[1] + 0.9 * arc, eye[2] + 0.5 * arc],
    at: lerp3(a.at, b.at, e),
    fov: lerp(a.fov, b.fov, e) + 4 * arc,
    cx: lerp(a.cx, b.cx, e),
    cy: lerp(a.cy, b.cy, e),
  };
}

/** How long a flight between pages takes (ms), and Solar's first tilt up to the roof. */
export const FLIGHT_MS = 1900;
export const INTRO_MS = 2600;
