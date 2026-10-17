import type { Op } from "~/features/live/utils/house3d";

type Stops = [number, string][];
/** The house's gradients (LiveHouse's HouseDefs, by their lh- ids) for a flight's canvas: keep the two in step. */
const GRAD: Record<string, Stops> = {
  glass: [
    [0, "#3b5486"],
    [0.45, "#22375f"],
    [1, "#121c33"],
  ],
  win: [
    [0, "#d7e6f7"],
    [0.45, "#a9c1de"],
    [1, "#8aa6c9"],
  ],
  winlit: [
    [0, "#fff0c4"],
    [0.45, "#ffc978"],
    [1, "#d9823f"],
  ],
  spill: [
    [0, "rgba(255,213,144,.55)"],
    [0.5, "rgba(255,192,106,.18)"],
    [1, "rgba(255,176,79,0)"],
  ],
  blind: [
    [0, "rgba(106,58,24,.55)"],
    [0.22, "rgba(106,58,24,.25)"],
    [0.3, "rgba(106,58,24,0)"],
  ],
  moon: [
    [0, "rgba(223,231,255,.9)"],
    [1, "rgba(223,231,255,0)"],
  ],
};

const stops = (g: CanvasGradient, name: string) => {
  for (const [o, c] of GRAD[name]) g.addColorStop(o, c);
  return g;
};

/** A flight's frame drawn to a canvas from drawing commands: the picture's frame (`w`×`h`) fitted like the SVG layers
 * (`xMidYMin slice`) onto the canvas, in its pixels. */
export function drawOps(cv: HTMLCanvasElement, ops: Op[], w: number, h: number) {
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const s = Math.max(cv.width / w, cv.height / h);
  const tx = (cv.width - w * s) / 2;
  const base = new DOMMatrix([s, 0, 0, s, tx, 0]);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.setTransform(base);
  const paths = new Map<string, Path2D>();
  const P = (d: string) => {
    let p = paths.get(d);
    if (!p) paths.set(d, (p = new Path2D(d)));
    return p;
  };
  const x0 = -tx / s;
  const wide = cv.width / s;
  const high = cv.height / s;
  const lin = (name: string, x1: number, y1: number, x2: number, y2: number) =>
    stops(ctx.createLinearGradient(x1, y1, x2, y2), name);
  const glass = lin("glass", 0, 0, w * 0.3, h);
  const radial = () => {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    return g;
  };
  /** Paints `fill` (colour or gradient name) through the current path/clip with the given alpha. */
  const fillWith = (path: Path2D, fill: string, a: number, win?: { x: number; y: number; w: number; h: number }) => {
    ctx.globalAlpha = a;
    if (!fill.startsWith("g:")) {
      ctx.fillStyle = fill;
      ctx.fill(path);
      return;
    }
    const name = fill.slice(2);
    if (name === "glass") {
      ctx.fillStyle = glass;
      ctx.fill(path);
      return;
    }
    if (!win) return;
    // Gradients on the pane's own box: clip to the pane, then fill a box-sized unit square.
    ctx.save();
    ctx.clip(path);
    ctx.translate(win.x, win.y);
    ctx.scale(win.w, win.h);
    if (name === "win") ctx.fillStyle = lin("win", 0, 0, 1, 1);
    else if (name === "blind") ctx.fillStyle = lin("blind", 0, 0, 0, 1);
    else {
      const g = ctx.createRadialGradient(0.5, 0.85, 0, 0.5, 0.85, 0.95);
      ctx.fillStyle = stops(g, "winlit");
    }
    ctx.fillRect(-1, -1, 3, 3);
    ctx.restore();
  };
  const ellipse = (cx: number, cy: number, rx: number, ry: number, fill: string, a: number) => {
    ctx.globalAlpha = a;
    if (fill.startsWith("g:")) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(rx, ry);
      ctx.fillStyle = stops(radial(), fill.slice(2));
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  let depth = 0;
  for (const o of ops) {
    switch (o.t) {
      case "haze": {
        const g = ctx.createLinearGradient(0, o.y, 0, o.y + o.h);
        g.addColorStop(0, withAlpha(o.col, 0));
        g.addColorStop(1, withAlpha(o.col, 0.7));
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.fillRect(x0 - 10, o.y, wide + 20, o.h);
        break;
      }
      case "in":
        ctx.save();
        ctx.clip(P(o.d));
        depth++;
        break;
      case "out":
        if (depth > 0) {
          ctx.restore();
          depth--;
        }
        break;
      case "full":
        ctx.globalAlpha = o.a;
        ctx.fillStyle = o.fill;
        ctx.fillRect(x0 - 10, -10, wide + 20, high + 20);
        break;
      case "e":
        ellipse(o.cx, o.cy, o.rx, o.ry, o.fill, o.op);
        break;
      case "c":
        ctx.globalAlpha = o.op;
        ctx.fillStyle = o.fill;
        ctx.beginPath();
        ctx.arc(o.cx, o.cy, o.r, 0, Math.PI * 2);
        ctx.fill();
        break;
      case "p": {
        const path = P(o.d);
        if (o.clip) {
          ctx.save();
          ctx.clip(P(o.clip));
        }
        if (o.stroke) {
          ctx.globalAlpha = o.op ?? 1;
          ctx.strokeStyle = o.stroke;
          ctx.lineWidth = o.w ?? 1;
          ctx.lineCap = "round";
          ctx.stroke(path);
        } else if (o.fill) {
          fillWith(path, o.fill, o.op ?? 1, o.win);
          if (o.seam && !o.fill.startsWith("g:")) {
            ctx.strokeStyle = o.fill;
            ctx.lineWidth = o.seam;
            ctx.lineJoin = "round";
            ctx.stroke(path);
          }
        }
        if (o.clip) ctx.restore();
        break;
      }
    }
  }
  while (depth-- > 0) ctx.restore();
  ctx.globalAlpha = 1;
}

/** `colour` (a css rgb(...) or #hex) with an alpha. */
function withAlpha(col: string, a: number): string {
  const m = col.match(/\d+(\.\d+)?/g);
  if (col.startsWith("rgb") && m && m.length >= 3) return `rgba(${m[0]},${m[1]},${m[2]},${a})`;
  if (col[0] === "#" && col.length === 7) {
    const n = parseInt(col.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }
  return col;
}
