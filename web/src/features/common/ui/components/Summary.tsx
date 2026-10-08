import type { ReactNode } from "react";
import { alpha } from "~/features/common/theme/utils/colors";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";

/**
 * A page's summary at the top (Solar, Home, Grid, Battery): its icon in a tile of its colour, then a row of figures
 * (SummaryStat), as many across as fit and wrapping onto another row where they don't, two across on a phone. The card
 * takes a wash of the colour from the left, `wash` strong. `footer` goes under the row (the grid's warnings); `label`
 * names it for screen readers.
 */
export function SummaryCard({
  icon,
  color,
  wash = 0.1,
  footer,
  label,
  className,
  children,
}: {
  icon: IconName;
  color: string;
  wash?: number;
  footer?: ReactNode;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "glass relative flex flex-col gap-5 overflow-hidden rounded-3xl border border-line-subtle p-7 max-sm:rounded-[20px] max-sm:p-5",
        className,
      )}
      style={{ backgroundImage: `linear-gradient(110deg, ${alpha(color, wash)}, transparent 55%)` }}
    >
      {/* The icon at the top left, level with the first row's labels when the figures wrap onto more. */}
      <div className="flex items-start gap-6 max-sm:gap-4">
        <span
          className="flex size-14 flex-none items-center justify-center rounded-[18px] transition-colors duration-500 max-sm:size-12 max-sm:rounded-2xl"
          style={{ background: alpha(color, 0.16), color }}
        >
          <Icon name={icon} size={26} />
        </span>
        <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-x-6 gap-y-4 max-sm:grid-cols-2">
          {children}
        </div>
      </div>
      {footer}
    </section>
  );
}

/**
 * One of a summary's figures: what it is, the figure, and a line under it. `dot` puts a dot of that colour before the
 * label (as a chart's legend does); `color` colours the figure itself (a warning's); `title` says more on hover.
 */
export function SummaryStat({
  label,
  value,
  sub,
  dot,
  color,
  title,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  dot?: string;
  color?: string;
  title?: string;
}) {
  return (
    <div title={title} className="flex min-w-0 flex-col gap-0.5">
      <span className="flex items-center gap-2 text-[13px] text-ink-muted">
        {dot && <i aria-hidden className="size-2 flex-none rounded-full" style={{ background: dot }} />}
        <span className="truncate">{label}</span>
      </span>
      <span
        className="truncate text-[22px] leading-7 font-light tracking-[-0.4px] text-ink tabular-nums"
        style={color ? { color } : undefined}
      >
        {value}
      </span>
      {sub && <span className="truncate text-xs text-ink-faint">{sub}</span>}
    </div>
  );
}
