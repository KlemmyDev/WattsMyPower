/** A dashboard row's least height, and the gap between rows and columns (px). */
export const ROW = 64;
export const GAP = 20;

/**
 * How much room a widget has, from its size on the grid, for choosing what it shows: how wide (`xs` up to 2 columns,
 * `sm` 3–4, `md` 5–7, `lg` 8 or more) and how tall (`short` up to 2 rows, `mid` 3–4, `tall` 5 or more), and the height
 * inside its card (px, less its border and `pad` each side). A row grows to fit what's in it, so a widget fits what it shows to
 * `inner` rather than stretching it: the smallest show the one thing that matters, and each step up adds more.
 */
export type Room = {
  w: number;
  h: number;
  wide: "xs" | "sm" | "md" | "lg";
  tall: "short" | "mid" | "tall";
  inner: number;
};

export function roomOf(w: number, h: number, pad = 20): Room {
  return {
    w,
    h,
    wide: w <= 2 ? "xs" : w <= 4 ? "sm" : w <= 7 ? "md" : "lg",
    tall: h <= 2 ? "short" : h <= 4 ? "mid" : "tall",
    inner: h * ROW + (h - 1) * GAP - 2 * (pad + 1),
  };
}
