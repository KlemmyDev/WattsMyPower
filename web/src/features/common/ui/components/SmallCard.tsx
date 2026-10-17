import type { ComponentProps, ReactNode } from "react";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";

/*
 * The live pages' cards under the sky card (docs/design-language.md, "Small cards"): one plain question each, a short
 * title with a faint note on the right, what answers it, and a line or two of words. They sit three across in a
 * CardGrid (two, then one, as the page narrows) and rise in one after another as the page opens.
 */

/** Three across where there's room, two on a narrower page, one on a phone. Cards in a row share its height. */
export function CardGrid({ className, ...rest }: ComponentProps<"div">) {
  return (
    <div className="@container">
      <div className={cn("card-grid grid grid-cols-1 gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3", className)} {...rest} />
    </div>
  );
}

/** A small card: its title and, on the right, a faint note ("Last 30 days", "Share sun on"), then its content. */
export function SmallCard({
  title,
  note,
  id,
  className,
  children,
  ...rest
}: Omit<ComponentProps<"section">, "title"> & { title: ReactNode; note?: ReactNode; id: string }) {
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "glass flex min-w-0 flex-col gap-3.5 rounded-[22px] border border-line-subtle px-[22px] py-5",
        className,
      )}
      {...rest}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="m-0 text-base leading-6 font-semibold">
          {title}
        </h2>
        {note != null && <span className="min-w-0 truncate text-xs text-ink-faint tabular-nums">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** A small card's words: muted, a line or two. */
export function CardText({ className, ...rest }: ComponentProps<"p">) {
  return <p className={cn("m-0 text-[13.5px] leading-5 text-pretty text-ink-muted", className)} {...rest} />;
}

export type Choice<T extends string> = {
  value: T;
  label: string;
  sub: string;
  icon: IconName;
  /** Its colour once chosen (the page's otherwise). */
  color?: string;
};

/**
 * A choice as tiles, each an icon, a name and a few words, the chosen one lit in its colour. Toggle buttons
 * (aria-pressed); `value` null when none of them is chosen (a custom setting, say).
 */
export function ChoiceTiles<T extends string>({
  label,
  options,
  value,
  onChange,
  color = COLOR.solar,
  disabled,
}: {
  label: string;
  options: Choice<T>[];
  value: T | null;
  onChange: (v: T) => void;
  color?: string;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const on = o.value === value;
        const c = o.color ?? color;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => !on && onChange(o.value)}
            className={cn(
              "flex min-w-0 cursor-pointer flex-col items-start gap-1 rounded-2xl border border-line bg-fg/3 p-3 text-left transition-[background-color,border-color] duration-300 hover:border-fg/20 disabled:cursor-default disabled:opacity-55",
              on && "hover:border-transparent",
            )}
            style={on ? { borderColor: alpha(c, 0.6), background: alpha(c, 0.1) } : undefined}
          >
            <Icon
              name={o.icon}
              size={18}
              style={{ color: on ? c : undefined }}
              className={cn(!on && "text-ink-faint")}
            />
            <span className="text-sm font-semibold">{o.label}</span>
            <span className="text-xs leading-4 text-pretty text-ink-faint">{o.sub}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A few facts, a name on the left and its value on the right. Falsy rows are left out. */
export function Facts({
  rows,
  className,
}: {
  rows: ([ReactNode, ReactNode] | false | null | undefined)[];
  className?: string;
}) {
  return (
    <dl className={cn("m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-[13px] tabular-nums", className)}>
      {rows.filter(Boolean).map((r, i) => {
        const [k, v] = r as [ReactNode, ReactNode];
        return (
          <div key={i} className="contents">
            <dt className="min-w-0 truncate text-ink-muted">{k}</dt>
            <dd className="m-0 text-right">{v}</dd>
          </div>
        );
      })}
    </dl>
  );
}
