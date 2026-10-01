import type { HTMLAttributes } from "react";
import { cn } from "~/features/common/ui/utils";

/** An inline message box. */
export function Notice({
  tone = "bad",
  className,
  ...rest
}: { tone?: "bad" | "warn" | "info" | "plain" } & HTMLAttributes<HTMLDivElement>) {
  const tones = {
    bad: "bg-bad-subtle text-bad",
    warn: "bg-warn-subtle",
    info: "bg-brand-subtle text-ink-muted",
    plain: "bg-canvas text-ink-muted",
  };
  return <div role="status" className={cn("rounded-xl px-4 py-3 text-sm", tones[tone], className)} {...rest} />;
}
