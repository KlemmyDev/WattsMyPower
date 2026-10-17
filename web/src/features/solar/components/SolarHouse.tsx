import { memo, useId, useState, type CSSProperties } from "react";
import { reducedMotion } from "~/features/common/display/utils";
import type { HouseOptions } from "~/features/overview/utils/house/layout";
import type { Atmosphere } from "~/features/solar/utils/atmosphere";
import { houseArt, type HouseArt } from "~/features/solar/utils/house3d";
import { clamp01, css, mix } from "~/features/solar/utils/sky";

/** The orange of the solar lines (the Overview house's energy lines use it too). */
const PV = "#ffb547";
/** Once a visit: the tilt up from the house to its roof. */
const TILTED = "wmp-solar-tilt";

/**
 * Your house along the bottom of Solar's sky, from low on its front corner: the end of its roof in front of you and
 * its street side, panels and all, running away across the sky. It's built as your house is (Settings → Your house):
 * its style's roof, the roof's colour, the walls' finish, one or two storeys, your panels. It keeps its own palette
 * in either theme (it's a picture of the sky, as the Overview's house is) and is lit by the sky: darker towards night
 * with its windows lit, cooler in rain, warm at the ends of the day, the glass wet in rain and catching the moon.
 *
 * How hard the panels are working (`share`, of the array's size) is told by the orange lines along each row: more of
 * them running, longer, brighter and quicker as the power rises, with a band of light crossing the glass. They stop
 * when the panels do.
 *
 * The first time the page opens in a visit the picture starts low on the house, at its wall and garden, and tilts up
 * to settle on the roof (by transform alone; not with motion turned down).
 */
export function SolarHouse({
  house,
  light,
  share,
  on,
  phone,
}: {
  house: HouseOptions;
  light: Atmosphere["light"];
  share: number;
  on: boolean;
  phone: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const art = houseArt(house, phone);
  const [tilt] = useState(firstVisit);
  const f = on ? clamp01(share) : 0;
  const L = clamp01(light.es * 3 + 0.25);
  const shade = (1 - L) * 0.64 + L * (0.1 * light.cover + 0.14 * light.rain);
  const shadeCol = css(mix(mix([96, 106, 126], [11, 18, 38], 1 - L), [44, 56, 80], light.rain * 0.5));
  const rim = L * clamp01(1 - light.es * 2.6) * (1 - 0.8 * light.cover) * 0.28;
  const len = 4 + 7 * f;
  const lines: CSSProperties = { ["--dur" as string]: `${(3.6 - 2.2 * f).toFixed(2)}s` };
  const comets = on ? [true, f > 0.25, f > 0.5, f > 0.75] : [false, false, false, false];
  const lit = clamp01(1 - L * 1.5) * 0.9;

  return (
    <div
      className={tilt ? "house-tilt absolute inset-x-0 top-0" : "absolute inset-x-0 top-0"}
      style={{
        height: `${(art.h / art.frame) * 100}%`,
        ["--lift" as string]: `${(-(art.h - art.frame) / art.h) * 100}%`,
      }}
    >
      <svg
        aria-hidden
        viewBox={`0 0 ${art.w} ${art.h}`}
        preserveAspectRatio="xMidYMin slice"
        className="pointer-events-none absolute inset-0 size-full"
      >
        <HouseDefs id={id} art={art} />
        <HouseBuilt art={art} id={id} />

        {/* What the glass shows: the sky's colour (more of it towards night), the warmth of making power. */}
        <g clipPath={`url(#${id}-glass)`}>
          <rect
            className="atm-fade"
            x={-200}
            y={-200}
            width={art.w + 400}
            height={art.h + 400}
            fill={light.horizon}
            fillOpacity={0.16 + 0.3 * (1 - L)}
          />
          <rect
            className="atm-fade"
            x={-200}
            y={-200}
            width={art.w + 400}
            height={art.h + 400}
            fill={PV}
            fillOpacity={on ? 0.03 + 0.2 * f : 0}
          />
          <g className="atm-fade" style={{ opacity: f > 0.06 ? 0.08 + 0.4 * f : 0 }}>
            <g className="roof-sheen" style={{ animationDuration: `${(10 - 5 * f).toFixed(1)}s` }}>
              <rect
                x={art.sheen.x}
                y={-300}
                width={108}
                height={art.h + 600}
                fill={`url(#${id}-sheen)`}
                fillOpacity={0.4}
                transform={`rotate(${art.sheen.rot.toFixed(1)} ${art.sheen.cx.toFixed(1)} ${art.sheen.cy.toFixed(1)})`}
              />
            </g>
          </g>
          <rect
            className="atm-fade"
            x={-200}
            y={-200}
            width={art.w + 400}
            height={art.h + 400}
            fill="#c8d4ea"
            fillOpacity={0.18}
            style={{ opacity: light.rain * 0.9 }}
          />
        </g>
        <path
          className="atm-fade"
          d={art.cells}
          fill="none"
          stroke="#ffd08a"
          strokeWidth={0.8}
          style={{ opacity: on ? 0.03 + 0.15 * f : 0 }}
        />

        {/* The light over all of it: night, rain, the warm ends of the day. */}
        <path className="atm-fade" d={art.built} fill={shadeCol} style={{ opacity: shade }} />
        <path className="atm-fade" d={art.roofs} fill="#ff9a5a" style={{ opacity: rim }} />
        {/* The windows lit from inside as it gets dark. */}
        <path className="atm-fade" d={art.windows} fill="#ffd27f" style={{ opacity: lit }} />

        {/* The strength of the solar: the orange lines along each row, with a soft glow under them. */}
        <g fill="none" stroke={PV} strokeLinecap="round" strokeWidth={3.4} style={lines}>
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
    </div>
  );
}

/** Whether this is the page's first showing this visit (and motion's welcome): then it tilts up to the roof. */
function firstVisit(): boolean {
  if (reducedMotion()) return false;
  try {
    if (sessionStorage.getItem(TILTED)) return false;
    sessionStorage.setItem(TILTED, "1");
  } catch {
    return false;
  }
  return true;
}

const HouseDefs = memo(function HouseDefs({ id, art }: { id: string; art: HouseArt }) {
  return (
    <defs>
      <linearGradient
        id={`${id}-glassfill`}
        gradientUnits="userSpaceOnUse"
        x1={0}
        y1={0}
        x2={art.w * 0.3}
        y2={art.frame}
      >
        <stop offset={0} stopColor="#3b5486" />
        <stop offset={0.45} stopColor="#22375f" />
        <stop offset={1} stopColor="#121c33" />
      </linearGradient>
      <linearGradient id={`${id}-win`} x1={0} y1={0} x2={1} y2={1}>
        <stop offset={0} stopColor="#d7e6f7" />
        <stop offset={0.45} stopColor="#a9c1de" />
        <stop offset={1} stopColor="#8aa6c9" />
      </linearGradient>
      <linearGradient id={`${id}-sheen`} x1={0} y1={0} x2={1} y2={0}>
        <stop offset={0} stopColor="#fff6e0" stopOpacity={0} />
        <stop offset={0.5} stopColor="#fff6e0" />
        <stop offset={1} stopColor="#fff6e0" stopOpacity={0} />
      </linearGradient>
      <radialGradient id={`${id}-moon`}>
        <stop offset={0} stopColor="#dfe7ff" stopOpacity={0.9} />
        <stop offset={1} stopColor="#dfe7ff" stopOpacity={0} />
      </radialGradient>
      <clipPath id={`${id}-glass`}>
        <path d={art.glass} />
      </clipPath>
    </defs>
  );
});

/** The house itself, far to near, drawn once per house. */
const HouseBuilt = memo(function HouseBuilt({ art, id }: { art: HouseArt; id: string }) {
  const fill = (f: string | undefined) =>
    f === "url(#GLASS)" ? `url(#${id}-glassfill)` : f === "url(#WIN)" ? `url(#${id}-win)` : (f ?? "none");
  return (
    <>
      {art.shapes.map((s, i) => (
        <path
          key={i}
          d={s.d}
          fill={s.stroke ? "none" : fill(s.fill)}
          stroke={s.stroke}
          strokeWidth={s.width}
          strokeLinecap={s.stroke ? "round" : undefined}
          opacity={s.opacity}
        />
      ))}
    </>
  );
});
