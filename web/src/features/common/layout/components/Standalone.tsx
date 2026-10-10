import type { ReactNode } from "react";
import { PageGlow } from "~/features/common/layout/components/PageGlow";
import { BrandMark } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";

/**
 * A page outside the dashboard's frame (signing in, the set-up guide): no side nav or dock, but the same soft light
 * behind it, for its glass cards to sit over as they do on every other page.
 */
export function StandalonePage({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("relative isolate min-h-screen bg-canvas [--nav-w:0px]", className)}>
      <PageGlow />
      {children}
    </div>
  );
}

/** The bolt in its tile and the name beside it, as the side nav has them (the name left off the narrowest phones). */
export function BrandLockup({ size = "md", className }: { size?: "md" | "lg"; className?: string }) {
  return (
    <span className={cn("flex items-center gap-3", className)}>
      <span
        className={cn(
          "flex flex-none items-center justify-center border border-fg/8 bg-linear-160 from-mark-from to-mark-to",
          size === "lg" ? "size-12 rounded-2xl" : "size-10 rounded-[13px]",
        )}
      >
        <BrandMark size={size === "lg" ? 20 : 18} />
      </span>
      <span
        className={cn(
          "font-display font-semibold whitespace-nowrap max-2xs:hidden",
          size === "lg" ? "text-xl tracking-[-0.5px]" : "text-lg tracking-[-0.4px]",
        )}
      >
        Watts<span className="text-solar">My</span>Power
      </span>
    </span>
  );
}
