import type { ReactNode } from "react";
import { cn } from "~/features/common/ui/utils";

/** A label / value row with a hairline underneath, as used in figure lists. */
export function DataRow({
  label,
  children,
  total,
  muted,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  /** Bold value, for a total line. */
  total?: boolean;
  /** Dim value, e.g. "Needs a full day of readings". */
  muted?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 border-b border-line-subtle py-3 text-sm tabular-nums",
        className,
      )}
    >
      <span className="text-ink-muted">{label}</span>
      <span className={cn("text-right", muted ? "font-normal text-ink-faint" : total ? "font-bold" : "font-medium")}>
        {children}
      </span>
    </div>
  );
}

/** A settings-style row: label column and value column. */
export function SettingRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(160px,1fr)_2fr] gap-4 border-b border-line-subtle px-6 py-3.5 text-sm">
      <span className="text-ink-muted">{label}</span>
      <span className="font-medium tabular-nums">{children}</span>
    </div>
  );
}
