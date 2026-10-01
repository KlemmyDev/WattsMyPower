import { createElement, Fragment, type ReactElement, type SVGAttributes } from "react";

/*
 * Drawing primitives for the isometric house: a tiny element builder and the isometric projection.
 * Shapes are given in scene units (x, y on the ground, z up) and projected onto the 1200 × 600 viewBox.
 */

export type Attrs = SVGAttributes<SVGElement>;
export type Kid = ReactElement | false | null | undefined;
type Kids = (Kid | Kid[])[];

// Two decimals is plenty for the drawing and keeps the DOM small.
const round = (attrs: Attrs): Attrs =>
  Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, typeof v === "number" ? +v.toFixed(2) : v]));

/** An SVG element. Children are spread (not passed as an array), so React needs no keys. */
export const h = (tag: string, attrs: Attrs = {}, ...kids: Kids): ReactElement =>
  createElement(tag, round(attrs), ...kids.flat());

/** Several elements without a wrapping <g>. */
export const group = (...kids: Kids): ReactElement => createElement(Fragment, null, ...kids.flat());

/** Deterministic 0..1 noise, so stars and raindrops land in the same places every time. */
export const noise = (i: number) => {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export const FLOW = { pv: "#ffb547", bat: "#6f8cff", grid: "#6b6f7a", car: "#3ee08f" };

export type P3 = [x: number, y: number, z?: number];
type XY = [number, number];

const K = 0.866;
const SC = 26;
const OX = 356;
const OY = 244;

/** Project a scene point onto the drawing. */
export const I = (x: number, y: number, z = 0): XY => [OX + (x - y) * K * SC, OY + (x + y) * 0.5 * SC - z * SC];

const pts = (arr: P3[]) =>
  arr
    .map((p) => {
      const q = I(...p);
      return q[0].toFixed(1) + "," + q[1].toFixed(1);
    })
    .join(" ");

export const poly = (arr: P3[], fill: string, o: Attrs = {}) =>
  h("polygon", { points: pts(arr), fill, strokeLinejoin: "round", ...o });

export const ln = (p0: P3, p1: P3, o: Attrs) => {
  const p = I(...p0);
  const q = I(...p1);
  return h("line", { x1: p[0], y1: p[1], x2: q[0], y2: q[1], strokeLinecap: "round", ...o });
};

export const dPath = (arr: P3[]) =>
  arr
    .map((p, i) => {
      const q = I(...p);
      return (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1);
    })
    .join(" ");

/** A drooping cable between two points. */
export const sag = (p0: P3, p1: P3, dy: number) => {
  const p = I(...p0);
  const q = I(...p1);
  return `M${p[0].toFixed(1)} ${p[1].toFixed(1)} Q ${((p[0] + q[0]) / 2).toFixed(1)} ${((p[1] + q[1]) / 2 + dy).toFixed(1)} ${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
};

/** The three visible faces of a box: front (y1), side (x1) and top. */
export const box = (
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  cT: string,
  cX: string,
  cY: string,
) => [
  poly(
    [
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    cY,
  ),
  poly(
    [
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x1, y0, z1],
    ],
    cX,
  ),
  poly(
    [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    cT,
  ),
];
