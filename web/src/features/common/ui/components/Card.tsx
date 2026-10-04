import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { cn } from "~/features/common/ui/utils";

/** The standard rounded panel. */
export function Card({ className, ...rest }: ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col gap-5 rounded-3xl border border-line-subtle bg-surface p-7 max-sm:rounded-[20px] max-sm:p-5",
        className,
      )}
      {...rest}
    />
  );
}

/** A card's title row: heading on the left, an optional action (link, pill) on the right. */
export function CardHeader({
  title,
  id,
  action,
  className,
}: {
  title: ReactNode;
  id?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <h2 id={id}>{title}</h2>
      {action}
    </div>
  );
}

/** Heading with a muted line underneath. */
export function TitleBlock({
  title,
  sub,
  id,
  className,
}: {
  title: ReactNode;
  sub?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <h2 id={id}>{title}</h2>
      {sub && <div className="text-[13px] leading-5 text-pretty text-ink-muted">{sub}</div>}
    </div>
  );
}

/** Small uppercase mono label, e.g. "30-DAY AVERAGE". */
export function Eyebrow({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("font-mono text-[11px] tracking-[1.2px] text-ink-faint uppercase", className)} {...rest} />
  );
}

/** Large light figure, e.g. "87%". */
export function BigNumber({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "text-[56px] leading-14 font-light tracking-[-2.5px] tabular-nums max-sm:text-[44px] max-sm:leading-12 max-sm:tracking-[-2px]",
        className,
      )}
      {...rest}
    />
  );
}

/** Muted explanatory text. */
export function Muted({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-[13px] leading-5 text-pretty text-ink-muted", className)} {...rest} />;
}

/** Small print at the bottom of a card. */
export function Footnote({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-wrap gap-4 text-xs text-ink-faint empty:hidden", className)} {...rest} />;
}
