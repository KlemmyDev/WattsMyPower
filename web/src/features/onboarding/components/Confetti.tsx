import { useMemo, type CSSProperties } from "react";
import { COLOR } from "~/features/common/theme/utils/colors";

const COLORS = [COLOR.solar, COLOR.battery, COLOR.good, COLOR.brand, COLOR.export, COLOR.lilac];

/** A repeatable 0..1 from a number, so the burst is the same on every render (and drawing stays pure). */
const rand = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * A burst of confetti in the energy colours, flying out from the middle of whatever holds it and falling away, once.
 * Nothing at all when motion is turned down (the pieces rest unseen).
 */
export function Confetti({ count = 42 }: { count?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = rand(i + 1) * Math.PI * 2;
        const reach = 90 + rand(i + 7) * 170;
        return {
          dx: Math.cos(angle) * reach,
          // Up more than down, then gravity takes them (the keyframes add the fall).
          dy: Math.sin(angle) * reach * 0.75 - 40,
          rot: (rand(i + 13) - 0.5) * 720,
          color: COLORS[i % COLORS.length],
          w: 5 + rand(i + 19) * 5,
          round: rand(i + 23) > 0.6,
          delay: rand(i + 29) * 120,
        };
      }),
    [count],
  );
  return (
    <span aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 z-0 size-0">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti absolute"
          style={
            {
              width: p.w,
              height: p.round ? p.w : p.w * 1.8,
              borderRadius: p.round ? "50%" : 2,
              background: p.color,
              "--dx": `${p.dx.toFixed(0)}px`,
              "--dy": `${p.dy.toFixed(0)}px`,
              "--rot": `${p.rot.toFixed(0)}deg`,
              animationDelay: `${p.delay.toFixed(0)}ms`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}
