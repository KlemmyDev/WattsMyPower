import { cn } from "~/features/common/ui/utils";

/** A placeholder block in the shape of what's loading, with a soft band sweeping across it (.skeleton). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded-2xl", className)} />;
}
