import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "~/features/common/ui/utils";

/** A settings panel, as wide as the page like a dashboard card. `padded` for forms; unpadded for edge-to-edge rows. */
export function SettingsCard({ padded, className, ...rest }: ComponentPropsWithRef<"section"> & { padded?: boolean }) {
  return (
    <section
      className={cn(
        "glass flex min-w-0 flex-col rounded-3xl border border-line-subtle max-sm:rounded-[20px]",
        padded ? "gap-6 p-7 max-sm:p-5" : "overflow-hidden",
        className,
      )}
      {...rest}
    />
  );
}

/** A settings panel's heading with a line of explanation underneath. */
export function SettingsTitle({ id, title, sub }: { id: string; title: ReactNode; sub: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 id={id}>{title}</h2>
      <div className="text-sm text-ink-muted">{sub}</div>
    </div>
  );
}
