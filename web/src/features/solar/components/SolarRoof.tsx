import { memo, useId, type CSSProperties } from "react";
import type { Atmosphere } from "~/features/solar/utils/atmosphere";
import { roofArt, ROOF_H, ROOF_W, type RoofArt } from "~/features/solar/utils/roof";
import { clamp01, css, mix } from "~/features/solar/utils/sky";

/** The orange of the solar lines (the Overview house's energy lines use it too). */
const PV = "#ffb547";

/**
 * Your roof along the bottom of Solar's sky: a Colorbond slope with its ridge sitting low like a horizon, two rows of
 * panels on it, lit by the sky above it. It keeps its own palette in either theme (it's a picture of the sky, as the
 * Overview's house is).
 *
 * How hard the panels are working (`share`, of the array's size) is told by the orange lines along each row: more
 * of them running, longer, brighter and quicker as the power rises, with a band of light crossing the glass and a
 * warmth in it. They stop when the panels do. The sky lights it: darker towards night, cooler in rain, warm at the
 * ends of the day, cloud shadows drifting over when it's cloudy, the glass wet in rain and catching the moon at night.
 */
export function SolarRoof({
  light,
  share,
  on,
  phone,
}: {
  light: Atmosphere["light"];
  /** What the panels are making, as a share of the array's size (0..1). */
  share: number;
  /** Whether they're making anything at all. */
  on: boolean;
  phone: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const art = roofArt(phone);
  const f = on ? clamp01(share) : 0;
  const L = clamp01(light.es * 3 + 0.25);
  const shade = (1 - L) * 0.64 + L * (0.1 * light.cover + 0.14 * light.rain);
  const shadeCol = css(mix(mix([96, 106, 126], [11, 18, 38], 1 - L), [44, 56, 80], light.rain * 0.5));
  const rim = L * clamp01(1 - light.es * 2.6) * (1 - 0.8 * light.cover) * 0.28;
  const clouds = L * 0.34 * clamp01((light.cover - 0.15) / 0.4) * (1 - 0.6 * light.rain);
  const len = 4 + 7 * f;
  const lines: CSSProperties = { ["--dur" as string]: `${(3.6 - 2.2 * f).toFixed(2)}s` };
  // One comet on each line as soon as there's power, up to four as the panels near their best.
  const comets = on ? [true, f > 0.25, f > 0.5, f > 0.75] : [false, false, false, false];

  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${ROOF_W} ${ROOF_H}`}
      preserveAspectRatio="xMinYMax slice"
      className="pointer-events-none absolute inset-0 size-full"
    >
      <RoofDefs art={art} id={id} horizon={light.horizon} />
      <RoofBuilt art={art} id={id} />

      {/* What the glass shows: the sky's colour (more of it towards night), a soft band of light, and the warmth of
          making power. */}
      <g clipPath={`url(#${id}-glass)`}>
        <rect
          className="atm-fade"
          x={-50}
          y={-50}
          width={1300}
          height={600}
          fill={light.horizon}
          fillOpacity={0.16 + 0.3 * (1 - L)}
        />
        <rect x={-50} y={-50} width={1300} height={600} fill={`url(#${id}-spec)`} />
        <rect
          className="atm-fade"
          x={-50}
          y={-50}
          width={1300}
          height={600}
          fill={PV}
          fillOpacity={on ? 0.03 + 0.2 * f : 0}
        />
      </g>
      <RoofCells art={art} warmth={on ? 0.03 + 0.15 * f : 0} />
      <g clipPath={`url(#${id}-glass)`} className="atm-fade" style={{ opacity: f > 0.06 ? 0.08 + 0.4 * f : 0 }}>
        <g className="roof-sheen" style={{ animationDuration: `${(10 - 5 * f).toFixed(1)}s` }}>
          <rect
            x={art.sheen.x}
            y={-200}
            width={108}
            height={900}
            fill={`url(#${id}-sheen)`}
            fillOpacity={0.4}
            transform={`rotate(${art.sheen.rot.toFixed(1)} ${art.sheen.cx.toFixed(1)} ${art.sheen.cy.toFixed(1)})`}
          />
        </g>
      </g>
      <g clipPath={`url(#${id}-glass)`} className="atm-fade" style={{ opacity: light.rain * 0.9 }}>
        <rect x={-50} y={-50} width={1300} height={600} fill="#c8d4ea" fillOpacity={0.18} />
      </g>

      <RoofRidge art={art} />

      {/* The light over all of it: night, rain, the warm ends of the day, cloud shadows, then haze far off. */}
      <path className="atm-fade" d={art.plane} fill={shadeCol} style={{ opacity: shade }} />
      <path className="atm-fade" d={art.plane} fill="#ff9a5a" style={{ opacity: rim }} />
      {clouds > 0.005 && (
        <g clipPath={`url(#${id}-roof)`} className="atm-fade" style={{ opacity: clouds }}>
          <g className="roof-cloud">
            {art.clouds.map((c, i) => (
              <ellipse key={i} cx={c.cx} cy={c.cy} rx={c.rx} ry={c.ry} fill={`url(#${id}-shadow)`} />
            ))}
          </g>
        </g>
      )}
      <g clipPath={`url(#${id}-roof)`}>
        <rect x={-50} y={-50} width={1300} height={600} fill={`url(#${id}-haze)`} />
      </g>

      {/* The strength of the solar: the orange lines along each row, with a soft glow under them. */}
      <g fill="none" stroke={PV} strokeLinecap="round" strokeWidth={3.4} style={lines} className="atm-fade">
        {art.rails.map((d, i) => (
          <g key={i} style={{ opacity: on ? 1 : 0 }} className="atm-fade">
            <path d={d} strokeWidth={10.8} strokeOpacity={0.12 + 0.45 * f} opacity={0.35} />
            <path d={d} strokeOpacity={0.12 + 0.45 * f} />
            {comets.map(
              (shown, k) =>
                shown && (
                  <path
                    key={k}
                    className="roof-comet"
                    d={d}
                    pathLength={100}
                    strokeDasharray={`${len.toFixed(1)} ${(100 - len).toFixed(1)}`}
                    style={{ animationDelay: `calc(var(--dur) * -${((k / 4 + i * 0.29) % 1).toFixed(3)})` }}
                  />
                ),
            )}
          </g>
        ))}
      </g>
      <ellipse
        className="atm-fade"
        cx={art.moon[0]}
        cy={art.moon[1]}
        rx={92}
        ry={14}
        fill={`url(#${id}-moon)`}
        style={{ opacity: light.moon * (1 - 0.8 * light.cover) * 0.4 }}
      />
    </svg>
  );
}

/** Gradients in the picture's own space, so the light and the glass's reflection run across the whole roof and array. */
const RoofDefs = memo(function RoofDefs({ art, id, horizon }: { art: RoofArt; id: string; horizon: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-sheet`} gradientUnits="userSpaceOnUse" x1={0} y1={art.ridgeTop} x2={0} y2={ROOF_H}>
        <stop offset={0} stopColor="#5c636e" />
        <stop offset={0.35} stopColor="#4a5059" />
        <stop offset={1} stopColor="#363b43" />
      </linearGradient>
      <linearGradient
        id={`${id}-glassfill`}
        gradientUnits="userSpaceOnUse"
        x1={0}
        y1={art.ridgeTop}
        x2={260}
        y2={ROOF_H}
      >
        <stop offset={0} stopColor="#3b5486" />
        <stop offset={0.45} stopColor="#22375f" />
        <stop offset={1} stopColor="#121c33" />
      </linearGradient>
      <linearGradient
        id={`${id}-spec`}
        gradientUnits="userSpaceOnUse"
        x1={0}
        y1={art.ridgeTop}
        x2={ROOF_W}
        y2={art.ridgeTop + 60}
      >
        <stop offset={0} stopColor="#fff" stopOpacity={0} />
        <stop offset={0.42} stopColor="#fff" stopOpacity={0.09} />
        <stop offset={0.5} stopColor="#fff" stopOpacity={0.11} />
        <stop offset={0.58} stopColor="#fff" stopOpacity={0.09} />
        <stop offset={1} stopColor="#fff" stopOpacity={0} />
      </linearGradient>
      <linearGradient id={`${id}-haze`} gradientUnits="userSpaceOnUse" x1={600} y1={0} x2={ROOF_W} y2={0}>
        <stop offset={0} stopColor={horizon} stopOpacity={0} />
        <stop offset={1} stopColor={horizon} stopOpacity={0.28} />
      </linearGradient>
      <linearGradient id={`${id}-sheen`} x1={0} y1={0} x2={1} y2={0}>
        <stop offset={0} stopColor="#fff6e0" stopOpacity={0} />
        <stop offset={0.5} stopColor="#fff6e0" />
        <stop offset={1} stopColor="#fff6e0" stopOpacity={0} />
      </linearGradient>
      <radialGradient id={`${id}-shadow`}>
        <stop offset={0} stopColor="#0b1226" />
        <stop offset={0.6} stopColor="#0b1226" stopOpacity={0.55} />
        <stop offset={1} stopColor="#0b1226" stopOpacity={0} />
      </radialGradient>
      <radialGradient id={`${id}-moon`}>
        <stop offset={0} stopColor="#dfe7ff" stopOpacity={0.9} />
        <stop offset={1} stopColor="#dfe7ff" stopOpacity={0} />
      </radialGradient>
      <clipPath id={`${id}-glass`}>
        <path d={art.glass} />
      </clipPath>
      <clipPath id={`${id}-roof`}>
        <path d={art.plane} />
      </clipPath>
    </defs>
  );
});

/** The sheet, its ribs, and the panels sitting on it: shadows, frames, glass. Drawn once. */
const RoofBuilt = memo(function RoofBuilt({ art, id }: { art: RoofArt; id: string }) {
  return (
    <>
      <path d={art.plane} fill={`url(#${id}-sheet)`} />
      <path d={art.ribsLight} fill="none" stroke="#fff" strokeOpacity={0.07} strokeWidth={1.2} />
      <path d={art.ribsDark} fill="none" stroke="#000" strokeOpacity={0.14} strokeWidth={1.2} />
      <path d={art.shadows} fill="#000" fillOpacity={0.28} />
      <path d={art.edges} fill="#7d8693" />
      <path d={art.frames} fill="#c3cad4" />
      <path d={art.frameTops} fill="none" stroke="#eef2f7" strokeWidth={1.4} />
      <path d={art.glass} fill={`url(#${id}-glassfill)`} />
    </>
  );
});

/** Mono cells: silver gaps, the diamonds where four cells meet, and the gaps warming as the panels work. */
const RoofCells = memo(function RoofCells({ art, warmth }: { art: RoofArt; warmth: number }) {
  return (
    <>
      <path d={art.gaps} fill="none" stroke="#c9d3e6" strokeOpacity={0.2} strokeWidth={0.8} />
      <path d={art.diamonds} fill="#dfe6f2" fillOpacity={0.32} />
      <path
        className="atm-fade"
        d={art.gaps}
        fill="none"
        stroke="#ffd08a"
        strokeWidth={0.85}
        style={{ opacity: warmth }}
      />
    </>
  );
});

/** The rolled ridge cap, catching the sky along its top. */
const RoofRidge = memo(function RoofRidge({ art }: { art: RoofArt }) {
  return (
    <>
      <path d={art.cap} fill="#3a3f47" />
      <path d={art.capLine} fill="none" stroke="#2b2f35" strokeWidth={4.6} strokeLinecap="round" />
      <path d={art.capLight} fill="none" stroke="#8a929e" strokeWidth={1.5} strokeLinecap="round" />
    </>
  );
});
