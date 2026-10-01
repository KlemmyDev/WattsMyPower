import { cn } from "~/features/common/ui/utils";

/** A small coloured key for legends: square (default), dot, or line. */
export function Swatch({
  color,
  shape = "square",
  size = 8,
  className,
}: {
  color: string;
  shape?: "square" | "dot" | "line";
  size?: number;
  className?: string;
}) {
  if (shape === "line")
    return (
      <i
        aria-hidden
        className={cn("inline-block h-[3px] w-3.5 flex-none rounded-xs", className)}
        style={{ background: color }}
      />
    );
  return (
    <i
      aria-hidden
      className={cn("inline-block flex-none", shape === "dot" ? "rounded-full" : "rounded-xs", className)}
      style={{ background: color, width: size, height: size }}
    />
  );
}
