import type { ReactNode } from "react";
import { Notice } from "~/features/common/ui/components/Notice";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { cn } from "~/features/common/ui/utils";

/*
 * How a Settings or Integrations page says where it stands before its sections can: a card-shaped placeholder while it
 * checks, and a boxed line when something's wrong, so every page looks the same while it loads or fails.
 */

/** While a page checks how things stand: its first section's shape, sweeping, with what it's doing for screen readers. */
export function PageLoading({ label, className }: { label: string; className?: string }) {
  return (
    <div role="status" className="flex flex-col">
      <span className="sr-only">{label}</span>
      <Skeleton className={cn("h-44 rounded-3xl max-sm:rounded-[20px]", className)} />
    </div>
  );
}

/**
 * Something's wrong on the page, above its sections: what happened, then what to do. `bad` for a failure, `warn` for
 * something that needs a look, `plain` for why there's nothing to show (the demo has no collector).
 */
export function PageProblem({ tone = "bad", children }: { tone?: "bad" | "warn" | "plain"; children: ReactNode }) {
  return (
    <Notice tone={tone} className="text-pretty">
      {children}
    </Notice>
  );
}
