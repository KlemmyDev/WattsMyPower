import type { HTMLAttributes } from "react";
import { cn } from "~/features/common/ui/utils";

export type PillTone = "ok" | "neutral" | "brand" | "inverse" | "good";

const tones: Record<PillTone, string> = {
  ok: "bg-good-subtle text-good",
  good: "bg-good-subtle text-good",
  neutral: "bg-surface-raised text-ink-muted",
  brand: "bg-brand-subtle text-brand",
  inverse: "bg-ink text-ink-inverse",
};

export function Pill({
  tone = "neutral",
  size = "md",
  className,
  ...rest
}: { tone?: PillTone; size?: "sm" | "md" } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "rounded-full font-semibold whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        tones[tone],
        className,
      )}
      {...rest}
    />
  );
}
