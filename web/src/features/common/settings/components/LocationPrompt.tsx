import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Notice } from "~/features/common/ui/components/Notice";
import { cn } from "~/features/common/ui/utils";

/**
 * In place of something worked out from where the house is (the forecast, weather, outages, warnings), until the
 * location's been chosen: what it needs, and a link to where it's set (Manage → Integrations → Weather).
 */
export function LocationPrompt({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Notice tone="plain" className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      <span>{children}</span>
      <Link to="/integrations/weather" className="font-medium text-brand no-underline hover:underline">
        Set your location
      </Link>
    </Notice>
  );
}
