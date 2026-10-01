import type { Cover, SkyMode } from "~/features/common/weather/utils";
import { FLOW, group, h, noise, type Kid } from "~/features/overview/utils/house/iso";

/* The sky behind the house for the current weather: gradient, sun or moon, clouds, stars, rain and lightning. */

const SKY: Record<SkyMode, [string, string]> = {
  sunny: ["#dcebff", "#f7fbff"],
  cloudy: ["#dfe4ea", "#f6f7f8"],
  rain: ["#c9d1dc", "#eceff3"],
  storm: ["#8e98a8", "#d3d8df"],
  night: ["#0b1224", "#1f2b47"],
};

const cloud = (cx: number, cy: number, sc: number, fill: string, dur: number, delay: number) =>
  h(
    "g",
    { style: { animation: `wmpDrift ${dur}s ease-in-out ${delay}s infinite alternate` } },
    h("circle", { cx: cx - 22 * sc, cy, r: 16 * sc, fill }),
    h("circle", { cx, cy: cy - 10 * sc, r: 23 * sc, fill }),
    h("circle", { cx: cx + 25 * sc, cy: cy + 1 * sc, r: 15 * sc, fill }),
    h("rect", { x: cx - 38 * sc, y: cy, width: 78 * sc, height: 16 * sc, rx: 8 * sc, fill }),
  );

const sun = (cx: number, cy: number, op: number) =>
  h(
    "g",
    { style: { opacity: op } },
    h("circle", { cx, cy, r: 20, fill: FLOW.pv }),
    h(
      "g",
      { style: { transformBox: "fill-box", transformOrigin: "center", animation: "wmpSpin 40s linear infinite" } },
      [0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
        const an = (k * Math.PI) / 4;
        return h("line", {
          x1: cx + Math.cos(an) * 28,
          y1: cy + Math.sin(an) * 28,
          x2: cx + Math.cos(an) * 37,
          y2: cy + Math.sin(an) * 37,
          stroke: FLOW.pv,
          strokeWidth: 2.2,
          strokeLinecap: "round",
        });
      }),
    ),
  );

/**
 * `back` goes behind the house, `front` (rain, lightning flash) over it.
 * cover only matters at night, where the sky is dark regardless of the weather.
 */
export function sky(wx: SkyMode, cover: Cover = "clear") {
  const E: Kid[] = [];
  const FRONT: Kid[] = [];
  E.push(
    h(
      "defs",
      {},
      Object.entries(SKY).map(([k, [c0, c1]]) =>
        h(
          "linearGradient",
          { id: "sky-" + k, x1: 0, y1: 0, x2: 0, y2: 1 },
          h("stop", { offset: "0", stopColor: c0 }),
          h("stop", { offset: "1", stopColor: c1 }),
        ),
      ),
      h("clipPath", { id: "skyClip" }, h("rect", { x: -200, y: 0, width: 1200, height: 600 })),
    ),
  );
  // A little past the edges, so rounding where the scene meets its box never leaves a seam.
  E.push(h("rect", { x: -204, y: -4, width: 1208, height: 608, fill: `url(#sky-${wx})` }));
  if (wx === "sunny")
    E.push(sun(905, 62, 1), cloud(300, 72, 0.7, "#ffffff", 26, -4), cloud(720, 110, 0.55, "#ffffff", 30, -11));
  if (wx === "cloudy")
    E.push(
      sun(890, 64, 0.8),
      cloud(860, 86, 1.25, "#ffffff", 24, -2),
      cloud(250, 64, 1.0, "#f1f3f6", 30, -9),
      cloud(470, 40, 0.8, "#ffffff", 22, -5),
    );
  if (wx === "rain")
    E.push(
      cloud(650, 72, 1.4, "#98a4b5", 26, -3),
      cloud(420, 50, 1.2, "#b1bac7", 30, -8),
      cloud(190, 74, 1.3, "#8c98a9", 22, -12),
    );
  if (wx === "storm")
    E.push(
      cloud(660, 70, 1.6, "#566172", 20, -3),
      cloud(450, 46, 1.4, "#6a7586", 26, -8),
      cloud(220, 72, 1.5, "#4b5566", 18, -12),
      cloud(330, 104, 1.1, "#5f6a7b", 24, -6),
    );
  const wetNight = wx === "night" && (cover === "rain" || cover === "storm");
  if (wx === "night" && cover !== "clear") {
    // clouds over a night sky; the heavier the weather, the darker and more of them
    const c = cover === "cloudy" ? "#39456a" : "#2a3350";
    E.push(cloud(640, 70, 1.3, c, 26, -3), cloud(300, 58, 1.1, c, 30, -9));
    if (cover !== "cloudy") E.push(cloud(470, 44, 1.2, "#232b45", 22, -6), cloud(170, 84, 1.2, "#262f4a", 24, -12));
  }
  if (wx === "night") {
    const stars = cover === "clear" ? 26 : cover === "cloudy" ? 10 : 0;
    for (let k = 0; k < stars; k++) {
      E.push(
        h("circle", {
          cx: -180 + noise(k * 4.1) * 1160,
          cy: 12 + noise(k * 9.7) * 170,
          r: 0.8 + noise(k * 2.3) * 1.1,
          fill: "#ffffff",
          style: {
            animation: `wmpTwinkle ${(2.5 + noise(k) * 3).toFixed(1)}s ease-in-out ${(-noise(k * 5) * 4).toFixed(1)}s infinite`,
          },
        }),
      );
    }
    if (!wetNight) E.push(h("path", { d: "M893 40a24 24 0 1 0 26 30 18 18 0 0 1-26-30Z", fill: "#f2efe2" }));
  }
  const storm = wx === "storm" || (wx === "night" && cover === "storm");
  if (wx === "rain" || wx === "storm" || wetNight) {
    const n = storm ? 120 : 70;
    const drops: Kid[] = [];
    for (let k = 0; k < n; k++) {
      const x = -220 + noise(k * 3.1) * 1280;
      const du = (storm ? 0.55 : 0.8) + noise(k * 1.9) * 0.4;
      drops.push(
        h("line", {
          x1: x,
          y1: -30,
          x2: x - 4,
          y2: -16,
          stroke: wetNight ? "#9fb0cc" : storm ? "#6f7f96" : "#8b9bb2",
          strokeWidth: 1.3,
          strokeLinecap: "round",
          strokeOpacity: 0.7,
          style: { animation: `wmpRain ${du.toFixed(2)}s linear ${(-noise(k * 7.3) * du).toFixed(2)}s infinite` },
        }),
      );
    }
    FRONT.push(h("g", { clipPath: "url(#skyClip)" }, drops));
  }
  if (storm) {
    FRONT.push(
      h("rect", {
        x: -200,
        y: 0,
        width: 1200,
        height: 600,
        fill: "#ffffff",
        style: { animation: "wmpFlashBg 7s linear infinite", pointerEvents: "none" },
      }),
    );
    E.push(
      h("path", {
        d: "M772 120 L756 170 L770 170 L750 224 L788 160 L772 160 L786 120 Z",
        fill: "#fff4b8",
        style: { animation: "wmpFlash 7s linear infinite" },
      }),
    );
  }
  return { back: group(E), front: group(FRONT) };
}
