import { useState, type CSSProperties } from "react";
import { cn } from "~/features/common/ui/utils";

/**
 * A reading that glints as it changes (not as it first shows): a quick light across it, so a new figure catches the
 * eye without anything moving. `on` is what counts as a change, for text that glides between readings (a tweened
 * figure would otherwise glint at every step).
 */
export function Glint({
  value,
  on = value,
  className,
  style,
}: {
  value: string;
  on?: unknown;
  className?: string;
  style?: CSSProperties;
}) {
  const [seen, setSeen] = useState(on);
  const [n, setN] = useState(0);
  if (on !== seen) {
    setSeen(on);
    setN(n + 1);
  }
  // A new key each time, so the glint starts over.
  return (
    <span key={n} className={cn(n > 0 && "glint", className)} style={style}>
      {value}
    </span>
  );
}
