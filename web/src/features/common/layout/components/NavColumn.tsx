import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useNavColumn } from "~/features/common/layout/hooks";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";

/**
 * The top of a section's column in the side nav: its name, back to its first page; a line on what's in it; and a
 * button that folds the column away (the section's icon in the rail opens it again).
 */
export function NavColumnHeader({ to, title, sub }: { to: "/home" | "/settings"; title: string; sub?: ReactNode }) {
  const [, setOpen] = useNavColumn();
  return (
    <div className="flex flex-col gap-1 px-2 pb-3">
      <div className="flex items-center gap-2">
        <Link
          to={to}
          className="font-display text-[21px] font-bold tracking-[-0.4px] text-ink no-underline hover:text-ink-hover"
        >
          {title}
        </Link>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Hide this column"
          title="Hide this column"
          className="ml-auto flex size-8 items-center justify-center rounded-[10px] text-ink-faint transition-colors hover:bg-fg/6 hover:text-ink"
        >
          <Icon name="panel" size={17} />
        </button>
      </div>
      {sub && <div className="text-[13px] leading-snug text-pretty text-ink-muted">{sub}</div>}
    </div>
  );
}

/** A small heading over a run of rows, with something short at its end (a total, "now"). */
export function NavColumnLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-2.5 pt-3 pb-1.5 text-xs font-medium text-ink-faint">
      <span className="min-w-0 truncate">{children}</span>
      {aside && <span className="tabular-nums">{aside}</span>}
    </div>
  );
}

/** A page's link in the column: put on the <Link>, with a <NavRow> inside it. */
export const NAV_ROW =
  "grid min-h-[38px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-[11px] px-2.5 py-1.5 text-[13.5px] text-ink-soft no-underline transition-colors duration-150 hover:bg-fg/4 hover:text-ink aria-[current=page]:bg-fg/7 aria-[current=page]:text-ink";
export const NAV_ROW_ACTIVE = { "aria-current": "page" } as const;

/** A row's contents: an icon or a dot in its colour, its name, a reading, and a bar for its share when it has one. */
export function NavRow({
  icon,
  color,
  label,
  value,
  share,
}: {
  icon?: IconName;
  color?: string;
  label: ReactNode;
  value?: ReactNode;
  /** Its part of the whole, 0 to 1. */
  share?: number;
}) {
  return (
    <>
      {icon ? (
        <Icon name={icon} size={16} style={{ color }} />
      ) : (
        <span className="size-2 rounded-full" style={{ background: color ?? alpha(COLOR.fg, 0.2) }} />
      )}
      <span className="truncate">{label}</span>
      <span className="text-[12.5px] text-ink-faint tabular-nums">{value}</span>
      {share != null && (
        <span className="col-span-full mt-1.5 h-0.5 overflow-hidden rounded-full bg-fg/7">
          <span
            className="block h-full rounded-full transition-[width] duration-700 ease-out-soft"
            style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%`, background: color }}
          />
        </span>
      )}
    </>
  );
}
