/*
 * Isometric house for the Power flow card, ported from the design's houseSvg.
 * drawHouse(L, wx, cover) returns { svg, labels, car } where
 *   L  holds values in kW: pv, grid (+ importing), bat (+ charging), soc (0..1), tesla, conn
 *   wx is the sky: "sunny" | "cloudy" | "rain" | "storm" | "night"
 *   cover is the weather at night: "clear" | "cloudy" | "rain" | "storm"
 * labels / car are {left, top} percentages for the HTML label pills.
 */
(() => {
  "use strict";

  const KEEP = new Set(["viewBox", "pathLength"]); // SVG attributes that really are camelCase
  const kebab = (k) => (KEEP.has(k) ? k : k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()));
  const styleStr = (o) => Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => `${kebab(k)}:${v}`).join(";");
  const num = (v) => (typeof v === "number" ? +v.toFixed(2) : v);
  const h = (tag, attrs = {}, ...kids) => {
    const a = Object.entries(attrs).filter(([, v]) => v != null)
      .map(([k, v]) => ` ${kebab(k)}="${k === "style" && typeof v === "object" ? styleStr(v) : num(v)}"`).join("");
    return `<${tag}${a}>${kids.flat().filter(Boolean).join("")}</${tag}>`;
  };
  const noise = (i) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };

  const FLOW = { pv: "#ffb547", bat: "#6f8cff", grid: "#6b6f7a", car: "#3ee08f" };
  const K = 0.866, SC = 26, OX = 356, OY = 244;
  const I = (x, y, z = 0) => [OX + (x - y) * K * SC, OY + (x + y) * 0.5 * SC - z * SC];
  const pts = (arr) => arr.map((p) => { const q = I(...p); return q[0].toFixed(1) + "," + q[1].toFixed(1); }).join(" ");
  const poly = (arr, fill, o = {}) => h("polygon", { points: pts(arr), fill, strokeLinejoin: "round", ...o });
  const ln = (p0, p1, o) => { const p = I(...p0), q = I(...p1); return h("line", { x1: p[0], y1: p[1], x2: q[0], y2: q[1], strokeLinecap: "round", ...o }); };
  const dPath = (arr) => arr.map((p, i) => { const q = I(...p); return (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1); }).join(" ");
  const sag = (p0, p1, dy) => { const p = I(...p0), q = I(...p1); return `M${p[0].toFixed(1)} ${p[1].toFixed(1)} Q ${((p[0] + q[0]) / 2).toFixed(1)} ${((p[1] + q[1]) / 2 + dy).toFixed(1)} ${q[0].toFixed(1)} ${q[1].toFixed(1)}`; };
  const box = (x0, x1, y0, y1, z0, z1, cT, cX, cY) => [
    poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], cY),
    poly([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], cX),
    poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], cT),
  ];
  const tree = (x, y, r = 20) => {
    const c = I(x, y, 2.4);
    return h("g", {}, ln([x, y, 0], [x, y, 1.5], { stroke: "#7a5a40", strokeWidth: 3.5 }),
      h("ellipse", { cx: c[0] + 3, cy: I(x, y, 0)[1] + 2, rx: r * 0.9, ry: r * 0.35, fill: "rgba(20,40,20,0.1)" }),
      h("circle", { cx: c[0], cy: c[1], r, fill: "#8fb07e" }),
      h("circle", { cx: c[0] + r * 0.28, cy: c[1] + r * 0.2, r: r * 0.62, fill: "#7a9d6a" }),
      h("circle", { cx: c[0] - r * 0.3, cy: c[1] - r * 0.3, r: r * 0.42, fill: "#a8c797" }));
  };
  const shrub = (x, y) => { const c = I(x, y, 0.35); return h("circle", { cx: c[0], cy: c[1], r: 7, fill: "#9dbd8c" }); };
  const PV = (u, v) => [u, 4 + 4.6 * v, 8 - 3.45 * v];
  const lift = (p) => [p[0], p[1] - 0.05, p[2] + 0.12];

  // Energy line: a faint track, and when power flows a tinted line with travelling "comets".
  function flow(d, v, forward, color, night) {
    const kw = Math.abs(v), on = kw > 0.05, du = Math.max(1.1, 3.2 - Math.round(kw) * 0.25).toFixed(2);
    const comet = (delay) => h("path", { d, pathLength: 100, fill: "none", stroke: color, strokeWidth: 2, strokeLinecap: "round", strokeDasharray: "7 93",
      style: { animation: `wmpComet ${du}s cubic-bezier(0.45,0,0.55,1) ${delay} infinite`, animationDirection: forward ? "normal" : "reverse" } });
    return h("g", {},
      h("path", { d, fill: "none", stroke: night ? "rgba(255,255,255,0.22)" : "rgba(17,17,17,0.16)", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" }),
      on ? h("path", { d, fill: "none", stroke: color, strokeOpacity: 0.28, strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" }) : "",
      on ? comet("0s") : "", on && kw > 2.5 ? comet(`-${(du / 2).toFixed(2)}s`) : "");
  }

  // ---------------------------------------------------------------- sky
  const SKY = { sunny: ["#dcebff", "#f7fbff"], cloudy: ["#dfe4ea", "#f6f7f8"], rain: ["#c9d1dc", "#eceff3"], storm: ["#8e98a8", "#d3d8df"], night: ["#0b1224", "#1f2b47"] };
  const cloud = (cx, cy, sc, fill, dur, delay) => h("g", { style: { animation: `wmpDrift ${dur}s ease-in-out ${delay}s infinite alternate` } },
    h("circle", { cx: cx - 22 * sc, cy, r: 16 * sc, fill }), h("circle", { cx, cy: cy - 10 * sc, r: 23 * sc, fill }), h("circle", { cx: cx + 25 * sc, cy: cy + 1 * sc, r: 15 * sc, fill }),
    h("rect", { x: cx - 38 * sc, y: cy, width: 78 * sc, height: 16 * sc, rx: 8 * sc, fill }));
  const sun = (cx, cy, op) => h("g", { style: { opacity: op } }, h("circle", { cx, cy, r: 20, fill: FLOW.pv }),
    h("g", { style: { transformBox: "fill-box", transformOrigin: "center", animation: "wmpSpin 40s linear infinite" } },
      [0, 1, 2, 3, 4, 5, 6, 7].map((k) => { const an = k * Math.PI / 4; return h("line", { x1: cx + Math.cos(an) * 28, y1: cy + Math.sin(an) * 28, x2: cx + Math.cos(an) * 37, y2: cy + Math.sin(an) * 37, stroke: FLOW.pv, strokeWidth: 2.2, strokeLinecap: "round" }); })));

  // wx: sky mode; cover: "clear" | "cloudy" | "rain" | "storm" (only matters at night, where the sky is dark regardless)
  function sky(wx, cover = "clear") {
    const E = [], FRONT = [];
    E.push(h("defs", {}, Object.entries(SKY).map(([k, [c0, c1]]) => h("linearGradient", { id: "sky-" + k, x1: 0, y1: 0, x2: 0, y2: 1 }, h("stop", { offset: "0", stopColor: c0 }), h("stop", { offset: "1", stopColor: c1 }))),
      h("clipPath", { id: "skyClip" }, h("rect", { x: -200, y: 0, width: 1200, height: 600 }))));
    E.push(h("rect", { x: -200, y: 0, width: 1200, height: 600, fill: `url(#sky-${wx})` }));
    if (wx === "sunny") E.push(sun(905, 62, 1), cloud(300, 72, 0.7, "#ffffff", 26, -4), cloud(720, 110, 0.55, "#ffffff", 30, -11));
    if (wx === "cloudy") E.push(sun(890, 64, 0.8), cloud(860, 86, 1.25, "#ffffff", 24, -2), cloud(250, 64, 1.0, "#f1f3f6", 30, -9), cloud(470, 40, 0.8, "#ffffff", 22, -5));
    if (wx === "rain") E.push(cloud(650, 72, 1.4, "#98a4b5", 26, -3), cloud(420, 50, 1.2, "#b1bac7", 30, -8), cloud(190, 74, 1.3, "#8c98a9", 22, -12));
    if (wx === "storm") E.push(cloud(660, 70, 1.6, "#566172", 20, -3), cloud(450, 46, 1.4, "#6a7586", 26, -8), cloud(220, 72, 1.5, "#4b5566", 18, -12), cloud(330, 104, 1.1, "#5f6a7b", 24, -6));
    const wetNight = wx === "night" && (cover === "rain" || cover === "storm");
    if (wx === "night" && cover !== "clear") {
      // clouds over a night sky; the heavier the weather, the darker and more of them
      const c = cover === "cloudy" ? "#39456a" : "#2a3350";
      E.push(cloud(640, 70, 1.3, c, 26, -3), cloud(300, 58, 1.1, c, 30, -9));
      if (cover !== "cloudy") E.push(cloud(470, 44, 1.2, "#232b45", 22, -6), cloud(170, 84, 1.2, "#262f4a", 24, -12));
    }
    if (wx === "night") {
      for (let k = 0; k < (cover === "clear" ? 26 : cover === "cloudy" ? 10 : 0); k++) {
        E.push(h("circle", { cx: -180 + noise(k * 4.1) * 1160, cy: 12 + noise(k * 9.7) * 170, r: 0.8 + noise(k * 2.3) * 1.1, fill: "#ffffff",
          style: { animation: `wmpTwinkle ${(2.5 + noise(k) * 3).toFixed(1)}s ease-in-out ${(-noise(k * 5) * 4).toFixed(1)}s infinite` } }));
      }
      if (!wetNight) E.push(h("path", { d: "M893 40a24 24 0 1 0 26 30 18 18 0 0 1-26-30Z", fill: "#f2efe2" }));
    }
    const storm = wx === "storm" || (wx === "night" && cover === "storm");
    if (wx === "rain" || wx === "storm" || wetNight) {
      const n = storm ? 120 : 70, drops = [];
      for (let k = 0; k < n; k++) {
        const x = -220 + noise(k * 3.1) * 1280, du = (storm ? 0.55 : 0.8) + noise(k * 1.9) * 0.4;
        drops.push(h("line", { x1: x, y1: -30, x2: x - 4, y2: -16, stroke: wetNight ? "#9fb0cc" : storm ? "#6f7f96" : "#8b9bb2", strokeWidth: 1.3, strokeLinecap: "round", strokeOpacity: 0.7,
          style: { animation: `wmpRain ${du.toFixed(2)}s linear ${(-noise(k * 7.3) * du).toFixed(2)}s infinite` } }));
      }
      FRONT.push(h("g", { clipPath: "url(#skyClip)" }, drops));
    }
    if (storm) {
      FRONT.push(h("rect", { x: -200, y: 0, width: 1200, height: 600, fill: "#ffffff", style: { animation: "wmpFlashBg 7s linear infinite", pointerEvents: "none" } }));
      E.push(h("path", { d: "M772 120 L756 170 L770 170 L750 224 L788 160 L772 160 L786 120 Z", fill: "#fff4b8", style: { animation: "wmpFlash 7s linear infinite" } }));
    }
    return { back: E.join(""), front: FRONT.join("") };
  }

  // ---------------------------------------------------------------- static scenery (built once)
  let S = null;
  function scenery() {
    const ground = [], house = [], front = [], yard = [];
    ground.push(h("defs", {},
      h("linearGradient", { id: "pvGrad", x1: 0, y1: 0, x2: 1, y2: 1 }, h("stop", { offset: "0", stopColor: "#2c4170" }), h("stop", { offset: "0.35", stopColor: "#5a79ad" }), h("stop", { offset: "0.5", stopColor: "#23365e" }), h("stop", { offset: "1", stopColor: "#16223d" })),
      h("linearGradient", { id: "glassL", x1: 0, y1: 0, x2: 1, y2: 1 }, h("stop", { offset: "0", stopColor: "#d7e6f7" }), h("stop", { offset: "0.45", stopColor: "#a9c1de" }), h("stop", { offset: "1", stopColor: "#8aa6c9" })),
      h("linearGradient", { id: "glassR", x1: 0, y1: 0, x2: 1, y2: 1 }, h("stop", { offset: "0", stopColor: "#9fb6d3" }), h("stop", { offset: "1", stopColor: "#6f8bb0" }))));
    ground.push(...box(-2, 15, -1, 10.4, -0.5, 0, "#e3e9da", "#c3ccb7", "#d2dac6"));
    ground.push(poly([[11, -1, 0.01], [15, -1, 0.01], [15, 10.4, 0.01], [11, 10.4, 0.01]], "#ebeae5"));
    ground.push(poly([[15, -1, -0.5], [15, 10.4, -0.5], [15, 10.4, 0], [15, -1, 0]], "#cfcdc6"), poly([[11, 10.4, -0.5], [15, 10.4, -0.5], [15, 10.4, 0], [11, 10.4, 0]], "#dcdad3"));
    for (const yy of [1.0, 7.0]) ground.push(ln([11.3, yy, 0.02], [14.7, yy, 0.02], { stroke: "rgba(0,0,0,0.06)", strokeWidth: 1.5 }));
    ground.push(poly([[5.2, 8, 0.01], [6.4, 8, 0.01], [6.4, 10.4, 0.01], [5.2, 10.4, 0.01]], "#ebeae5"));
    ground.push(poly([[0, 8, 0.02], [10, 8, 0.02], [10.6, 10.4, 0.02], [0.6, 10.4, 0.02]], "rgba(30,40,30,0.08)"));

    // back tree, power pole, walls, windows, door, meter
    house.push(tree(-1.2, 2.2, 26));
    { const b = I(-2.2, 7, 0); house.push(h("ellipse", { cx: b[0] + 4, cy: b[1] + 1, rx: 8, ry: 3, fill: "rgba(0,0,0,0.12)" })); }
    house.push(ln([-1.5, 9.7, 0], [-1.5, 9.7, 8.2], { stroke: "#7b6652", strokeWidth: 4.5 }), ln([-1.5, 8.8, 7.6], [-1.5, 10.6, 7.6], { stroke: "#7b6652", strokeWidth: 3 }));
    house.push(poly([[-0.4, 4, 8], [10.4, 4, 8], [10.4, -0.6, 4.55], [-0.4, -0.6, 4.55]], "#353a42"));
    house.push(poly([[10, 0, 0], [10, 8, 0], [10, 8, 5], [10, 0, 5]], "#ddd6ca"), poly([[10, 0, 5], [10, 8, 5], [10, 4, 8]], "#d6cfc2"));
    house.push(poly([[0, 8, 0], [10, 8, 0], [10, 8, 5], [0, 8, 5]], "#f6f2eb"));
    house.push(poly([[0, 8.01, 0], [10, 8.01, 0], [10, 8.01, 0.35], [0, 8.01, 0.35]], "#d8d2c6"), poly([[10.01, 0, 0], [10.01, 8, 0], [10.01, 8, 0.35], [10.01, 0, 0.35]], "#c2bbad"));
    for (const [x0, x1] of [[1.4, 3.4], [7.4, 9.2]]) {
      house.push(poly([[x0 - 0.14, 8.02, 1.64], [x1 + 0.14, 8.02, 1.64], [x1 + 0.14, 8.02, 3.76], [x0 - 0.14, 8.02, 3.76]], "#ffffff", { stroke: "#cfc8bb", strokeWidth: 0.8 }));
      house.push(poly([[x0, 8.03, 1.78], [x1, 8.03, 1.78], [x1, 8.03, 3.62], [x0, 8.03, 3.62]], "url(#glassL)"));
      house.push(ln([(x0 + x1) / 2, 8.04, 1.78], [(x0 + x1) / 2, 8.04, 3.62], { stroke: "#ffffff", strokeWidth: 2 }));
      house.push(poly([[x0 - 0.25, 8.3, 1.55], [x1 + 0.25, 8.3, 1.55], [x1 + 0.25, 8.02, 1.64], [x0 - 0.25, 8.02, 1.64]], "#e9e3d8"));
    }
    house.push(poly([[5.1, 8.02, 0], [6.5, 8.02, 0], [6.5, 8.02, 3.25], [5.1, 8.02, 3.25]], "#ffffff", { stroke: "#cfc8bb", strokeWidth: 0.8 }));
    house.push(poly([[5.25, 8.03, 0], [6.35, 8.03, 0], [6.35, 8.03, 3.1], [5.25, 8.03, 3.1]], "#6e5038"));
    { const dh = I(6.15, 8.04, 1.5); house.push(h("circle", { cx: dh[0], cy: dh[1], r: 1.8, fill: "#e0c48a" })); }
    house.push(poly([[0.6, 8.03, 2.7], [1.2, 8.03, 2.7], [1.2, 8.03, 3.55], [0.6, 8.03, 3.55]], "#ececec", { stroke: "#a9a9a9", strokeWidth: 0.8 }));

    // side window, front roof with panels, gutters, porch light, bin
    front.push(poly([[10.02, 1.26, 1.64], [10.02, 3.54, 1.64], [10.02, 3.54, 3.76], [10.02, 1.26, 3.76]], "#f4f1ea", { stroke: "#bfb8aa", strokeWidth: 0.8 }));
    front.push(poly([[10.03, 1.4, 1.78], [10.03, 3.4, 1.78], [10.03, 3.4, 3.62], [10.03, 1.4, 3.62]], "url(#glassR)"));
    front.push(ln([10.04, 2.4, 1.78], [10.04, 2.4, 3.62], { stroke: "#f4f1ea", strokeWidth: 2 }));
    front.push(poly([[-0.4, 4, 8], [10.4, 4, 8], [10.4, 8.6, 4.55], [-0.4, 8.6, 4.55]], "#4a5059"));
    for (const v of [0.2, 0.4, 0.6, 0.8]) front.push(ln(PV(-0.4, v), PV(10.4, v), { stroke: "rgba(255,255,255,0.06)", strokeWidth: 1 }));
    for (let rr = 0; rr < 2; rr++) for (let c = 0; c < 5; c++) {
      const u0 = 0.55 + c * 1.9, u1 = u0 + 1.76, v0 = 0.1 + rr * 0.41, v1 = v0 + 0.37;
      front.push(poly([PV(u0, v1), PV(u1, v1), PV(u1, v0), PV(u0, v0)].map(lift), "url(#pvGrad)", { stroke: "#d9dee6", strokeWidth: 1 }));
      for (const t of [1 / 3, 2 / 3]) { const uu = u0 + (u1 - u0) * t; front.push(ln(lift(PV(uu, v0)), lift(PV(uu, v1)), { stroke: "rgba(255,255,255,0.14)", strokeWidth: 0.7 })); }
      const vm = (v0 + v1) / 2; front.push(ln(lift(PV(u0, vm)), lift(PV(u1, vm)), { stroke: "rgba(255,255,255,0.14)", strokeWidth: 0.7 }));
    }
    front.push(ln([-0.4, 4, 8], [10.4, 4, 8], { stroke: "#2b2f35", strokeWidth: 3.5 }));
    front.push(ln([-0.4, 8.6, 4.55], [10.4, 8.6, 4.55], { stroke: "#ffffff", strokeWidth: 3 }), ln([10.4, 4, 8], [10.4, 8.6, 4.55], { stroke: "#ffffff", strokeWidth: 3 }), ln([10.4, 4, 8], [10.4, -0.6, 4.55], { stroke: "#f0ede6", strokeWidth: 3 }), ln([-0.4, 4, 8], [-0.4, 8.6, 4.55], { stroke: "#ffffff", strokeWidth: 2.5 }));
    front.push(ln([-0.3, 8.5, 4.45], [10.3, 8.5, 4.45], { stroke: "#b9b4aa", strokeWidth: 2.5 }), ln([9.85, 8.35, 4.45], [9.85, 8.35, 0.1], { stroke: "#b9b4aa", strokeWidth: 2.5 }));
    { const wl = I(6.8, 8.04, 2.6); front.push(h("rect", { x: wl[0] - 2.5, y: wl[1] - 4, width: 5, height: 8, rx: 1.5, fill: "#2b2b2b" }), h("circle", { cx: wl[0], cy: wl[1] + 1, r: 1.5, fill: "#ffd27a" })); }
    front.push(...box(6.9, 7.2, 9.9, 10.2, 0, 1.2, "#3b3f45", "#2e3136", "#44484f"));
    // inverter and battery cases
    front.push(...box(10, 10.22, 5.6, 6.4, 2.4, 3.4, "#ffffff", "#f3f3f3", "#dddddd"));
    front.push(...box(10, 10.32, 3.9, 5.1, 0.3, 2.9, "#ffffff", "#fafafa", "#e1e1e1"));

    // charger box, garden, empty parking space
    yard.push(...box(10, 10.14, 7.0, 7.4, 1.5, 2.3, "#fafafa", "#f1f1f1", "#d9d9d9"));
    for (const x of [0.6, 1.3, 3.7, 4.4, 7.1, 7.8, 9.5]) yard.push(shrub(x, 8.45));
    yard.push(tree(1.2, 10.3, 20));

    // wet ground for rain/storm
    const wet = [poly([[-2, -1, 0.03], [15, -1, 0.03], [15, 10.4, 0.03], [-2, 10.4, 0.03]], "rgba(70,90,120,0.1)")];
    for (const [px0, py0, rx] of [[12.4, 8.6, 30], [14.2, 0.2, 22], [5.8, 9.6, 16], [13.1, 9.8, 18]]) { const c = I(px0, py0, 0.03); wet.push(h("ellipse", { cx: c[0], cy: c[1], rx, ry: rx * 0.36, fill: "rgba(140,160,190,0.45)" })); }

    // night: dim everything, then light the windows and porch
    const night = [h("rect", { x: -200, y: 0, width: 1200, height: 600, fill: "#16203a", fillOpacity: 0.55, style: { mixBlendMode: "multiply" } })];
    const warm = "#ffd27f";
    for (const [x0, x1] of [[1.4, 3.4], [7.4, 9.2]]) {
      night.push(poly([[x0 - 0.3, 8.35, 0.03], [x1 + 0.3, 8.35, 0.03], [x1 + 1.3, 10.3, 0.03], [x0 - 0.5, 10.3, 0.03]], warm, { fillOpacity: 0.16 }));
      night.push(poly([[x0, 8.03, 1.78], [x1, 8.03, 1.78], [x1, 8.03, 3.62], [x0, 8.03, 3.62]], warm), ln([(x0 + x1) / 2, 8.04, 1.78], [(x0 + x1) / 2, 8.04, 3.62], { stroke: "#d9a652", strokeWidth: 2 }));
    }
    night.push(poly([[10.03, 1.4, 1.78], [10.03, 3.4, 1.78], [10.03, 3.4, 3.62], [10.03, 1.4, 3.62]], "#f5c46e"));
    { const wl = I(6.8, 8.04, 2.6); night.push(h("circle", { cx: wl[0], cy: wl[1] + 4, r: 26, fill: warm, fillOpacity: 0.3 }), h("circle", { cx: wl[0], cy: wl[1] + 1, r: 3, fill: "#fff3cf" })); }

    return { ground: ground.join(""), house: house.join(""), front: front.join(""), yard: yard.join(""), wet: wet.join(""), night: night.join(""),
      parking: poly([[11.75, 1.35, 0.02], [13.95, 1.35, 0.02], [13.95, 6.6, 0.02], [11.75, 6.6, 0.02]], "none", { stroke: "rgba(0,0,0,0.28)", strokeWidth: 1.5, strokeDasharray: "6 6" }) };
  }

  // Battery charge gauge on the battery case: 10 segments, the next one pulses while charging.
  function gauge(L) {
    const out = [], seg = 10, filled = Math.round(L.soc * seg), charging = L.bat > 0.05;
    for (let k = 0; k < seg; k++) {
      const z0 = 0.62 + k * 0.205, z1 = z0 + 0.16, on = k < filled, next = charging && k === filled;
      out.push(poly([[10.33, 4.3, z0], [10.33, 4.7, z0], [10.33, 4.7, z1], [10.33, 4.3, z1]], on ? FLOW.bat : next ? "#8fa6ff" : "#e6e7ea", next ? { style: { animation: "wmpPulse 1.4s ease-in-out infinite" } } : {}));
    }
    return out.join("");
  }
  const invLed = (r) => { const d = I(10.23, 5.85, 3.15); return h("circle", { cx: d[0], cy: d[1], r, fill: FLOW.pv }); };

  // Where each label pill's leader line starts (the pills sit at the card's left and right edges),
  // and the point on the drawing it points at. The scene spans x -200..1000.
  const LBL = {
    solar: [[760, 185], I(5, 6.2, 6.5)],
    grid: [[-20, 380], I(-1.5, 9.7, 8.2)],
    home: [[-20, 485], I(2.4, 8, 2.7)],
    battery: [[760, 320], I(10.33, 4.5, 1.8)],
    tesla: [[760, 470], I(13.95, 4.3, 1.0)],
  };
  const px = (p) => ({ left: ((p[0] + 200) / 1200 * 100).toFixed(2) + "%", top: (p[1] / 600 * 100).toFixed(2) + "%" });

  window.drawHouse = function drawHouse(L, wx = "sunny", cover = "clear") {
    if (!S) S = scenery();
    const night = wx === "night", sk = sky(wx, cover);
    const wetGround = wx === "rain" || wx === "storm" || (night && (cover === "rain" || cover === "storm"));
    const flows = [
      flow(sag([-1.5, 8.9, 7.6], [0.9, 8.03, 3.4], 34), L.grid, L.grid > 0, FLOW.grid, night),                                   // pole to house
      flow(dPath([[9.2, 8.1, 4.95], [10.03, 7.7, 4.72], [10.03, 6.0, 4.72], [10.03, 6.0, 3.4]]), L.pv, true, FLOW.pv, night),         // roof to inverter
      flow(dPath([[10.03, 6.0, 2.4], [10.03, 6.0, 0.9], [10.03, 5.05, 0.9]]), L.bat, L.bat > 0, FLOW.bat, night),                     // inverter to battery
    ].join("");
    const chLed = (() => { const d = I(10.15, 7.2, 2.1); return h("circle", { cx: d[0], cy: d[1], r: 1.8, fill: L.conn ? FLOW.car : "#bbbbbb" }); })();

    let leaders = "";
    for (const [k, [lp, an]] of Object.entries(LBL)) {
      if (k === "tesla" && !L.conn) continue;
      const lc = { solar: FLOW.pv, grid: "#3a3d44", home: "#111111", battery: FLOW.bat, tesla: FLOW.car }[k];
      leaders += h("line", { class: "ld", x1: lp[0], y1: lp[1], x2: an[0], y2: an[1], stroke: night ? "#ffffff" : "#111111", strokeOpacity: 0.35, strokeWidth: 1 }) +
        h("circle", { cx: an[0], cy: an[1], r: 7, fill: lc, fillOpacity: 0.18 }) +
        h("circle", { cx: an[0], cy: an[1], r: 3.5, fill: lc, stroke: "#ffffff", strokeWidth: 1.5 });
    }

    // "slice" so a narrower frame (phones use 4:3) crops the empty sky at the sides rather than shrinking the house.
    const svg = `<svg viewBox="-200 0 1200 600" preserveAspectRatio="xMidYMid slice" class="house-svg" aria-hidden="true">` +
      sk.back + S.ground + (wetGround ? S.wet : "") + S.house + S.front +
      invLed(2) + gauge(L) + ln([10.33, 4.9, 2.55], [10.33, 4.9, 2.7], { stroke: "#c9ccd2", strokeWidth: 2 }) +
      S.yard + chLed + (L.conn ? "" : S.parking) +
      (night ? S.night + gauge(L) + invLed(2.2) : "") +
      flows + sk.front + `<g class="leaders">${leaders}</g></svg>`;
    const car = I(12.85, 4, 0.6);
    return { svg, labels: Object.fromEntries(Object.entries(LBL).map(([k, [lp]]) => [k, px(lp)])), car: px(car),
      // the same point in the 4:3 phone crop, which shows x 0..800 of the scene
      carMobile: { left: (car[0] / 800 * 100).toFixed(2) + "%", top: (car[1] / 600 * 100).toFixed(2) + "%" } };
  };
})();
