import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { carsQuery } from "~/features/car/api";
import { useCarChange } from "~/features/car/hooks";
import type { CarColour, CarView } from "~/features/car/types";
import { PAINT, PAINTS } from "~/features/car/utils";
import { cn } from "~/features/common/ui/utils";
import { useEvChange } from "~/features/ev/hooks";

/** Tesla's own paints, as Tessie names them (app.features.tesla.control.PAINTS), for a Tesla's picker. */
const TESLA: { label: string; hex: `#${string}` }[] = [
  { label: "Pearl White", hex: "#ecebe6" },
  { label: "Solid Black", hex: "#1d1e21" },
  { label: "Midnight Silver", hex: "#50555c" },
  { label: "Stealth Grey", hex: "#3e4247" },
  { label: "Quicksilver", hex: "#a6aaaf" },
  { label: "Deep Blue", hex: "#1f3f78" },
  { label: "Red", hex: "#9b1b22" },
  { label: "Ultra Red", hex: "#b3161d" },
];

const SETTLE = 450; // ms after the last move of the colour wheel before it's saved

/**
 * Your car's paint, from the EV page's sky: a chip with its colour that opens a few swatches (a Tesla's own paints, else
 * the usual ones) and a colour of your own. It's shown on the car straight away (`onTry`, until what's saved says it)
 * and saved to its dashboard car, or to the Tesla itself when it has none, so the Overview's drawing takes it too.
 */
export function CarPaint({
  id,
  vin,
  hex,
  tesla,
  onTry,
  className,
}: {
  /** Its dashboard car, if it has one; else it's kept with the Tesla (`vin`). */
  id: number | undefined;
  vin: string;
  /** The paint it's drawn in now. */
  hex: string;
  tesla: boolean;
  /** Shows a paint on the car before it's saved; null to show what's saved again. */
  onTry: (hex: string | null) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { update } = useCarChange();
  const { configure } = useEvChange("tesla");
  const failed = id != null ? update : configure;
  const qc = useQueryClient();
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const panel = useId();
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const save = (colour: CarColour, shown: string) => {
    onTry(shown);
    if (id == null) return configure.mutate({ vin, paint: shown }, { onError: () => onTry(null) });
    update.mutate(
      { id, car_colour: colour },
      {
        // The saved car straight into the list, so the drawing doesn't flick back while it's fetched again.
        onSuccess: (view) =>
          qc.setQueryData<CarView[]>(carsQuery.queryKey, (cars) => cars?.map((c) => (c.id === view.id ? view : c))),
        onError: () => onTry(null),
      },
    );
  };
  const swatches: { label: string; hex: string; colour: CarColour }[] = tesla
    ? TESLA.map((p) => ({ ...p, colour: p.hex }))
    : PAINTS.map((c) => ({ ...PAINT[c], colour: c }));
  const chosen = swatches.find((s) => s.hex.toLowerCase() === hex.toLowerCase());

  return (
    <div ref={box} className={cn("relative", className)}>
      {open && (
        <div
          id={panel}
          role="dialog"
          aria-label="Your car's paint"
          className="absolute right-0 bottom-full mb-2 flex w-[244px] flex-col gap-2.5 rounded-2xl border border-line bg-surface p-3.5 text-ink shadow-lg"
        >
          <span className="text-[13px] font-semibold">Your car's paint</span>
          <div role="radiogroup" aria-label="Paint" className="grid grid-cols-5 gap-2">
            {swatches.map((s) => (
              <button
                key={s.hex}
                type="button"
                role="radio"
                aria-checked={chosen?.hex === s.hex}
                aria-label={s.label}
                title={s.label}
                onClick={() => save(s.colour, s.hex)}
                className={cn(
                  "size-8 cursor-pointer rounded-full border border-fg/20 transition-shadow",
                  chosen?.hex === s.hex && "shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-ink)]",
                )}
                style={{ background: s.hex }}
              />
            ))}
            <label
              title="A colour of your own"
              className={cn(
                "relative flex size-8 cursor-pointer overflow-hidden rounded-full border border-fg/20 transition-shadow",
                !chosen && "shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-ink)]",
              )}
              style={{ background: chosen ? "conic-gradient(#e44,#ec4,#4c6,#4ae,#a4e,#e44)" : hex }}
            >
              <span className="sr-only">A colour of your own</span>
              <input
                type="color"
                value={hex}
                onChange={(e) => {
                  const c = e.target.value as `#${string}`;
                  onTry(c);
                  clearTimeout(timer.current);
                  timer.current = setTimeout(() => save(c, c), SETTLE);
                }}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
            </label>
          </div>
          <span className={cn("text-xs", failed.isError ? "text-bad" : "text-ink-muted")}>
            {failed.isError ? errorMessage(failed.error) : chosen ? chosen.label : `Your own, ${hex}`}
          </span>
        </div>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panel : undefined}
        onClick={() => setOpen(!open)}
        className="flex min-h-9 cursor-pointer items-center gap-2 rounded-full border border-white/14 bg-black/30 py-1.5 pr-3.5 pl-2 text-[13px] text-white backdrop-blur-sm transition-colors hover:bg-black/40 max-sm:min-h-[34px]"
      >
        <span className="size-[18px] rounded-full border border-white/40" style={{ background: hex }} />
        Paint
      </button>
    </div>
  );
}
