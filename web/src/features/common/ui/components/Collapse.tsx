import { useState, type ReactNode } from "react";
import { cn } from "~/features/common/ui/utils";

/**
 * What opens under an accordion's row: it grows from nothing to its own height as `open` turns on, and folds back up
 * as it turns off, fading a touch as it goes (a grid row easing between 0fr and 1fr, so no height to measure). Nothing
 * inside is drawn until it's first opened, then it stays, so it can fold away smoothly. Still, where the device asks
 * for less motion. `className` is for the content itself (its padding, gaps), inside what folds.
 */
export function Collapse({
  open,
  id,
  className,
  children,
}: {
  open: boolean;
  /** For the row's aria-controls. */
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const [seen, setSeen] = useState(open);
  if (open && !seen) setSeen(true);
  return (
    <div
      id={id}
      inert={!open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-300 ease-out-soft motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="min-h-0 overflow-hidden">{seen && <div className={className}>{children}</div>}</div>
    </div>
  );
}
