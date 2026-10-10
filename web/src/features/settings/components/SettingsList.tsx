import { createLink, type LinkComponent } from "@tanstack/react-router";
import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";
import { alpha } from "~/features/common/theme/utils/colors";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";

/** A group of settings rows under a small heading, as a traditional settings list: one card, a line between rows. */
export function SettingsGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-2">
      <h2 id={id} className="px-1 text-[13px] font-semibold text-ink-muted">
        {title}
      </h2>
      <div className="glass flex flex-col overflow-hidden rounded-3xl border border-line-subtle max-sm:rounded-[20px]">
        {children}
      </div>
    </section>
  );
}

type RowProps = {
  icon: IconName;
  /** The icon's colour, a theme colour (COLOR.solar…), on a tint of it. */
  color: string;
  label: ReactNode;
  /** A line under the label: what's set, or what's there. */
  detail?: ReactNode;
  /** On the right before the chevron: a pill, or a short value. */
  aside?: ReactNode;
};

const RowAnchor = forwardRef<HTMLAnchorElement, RowProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children">>(
  function RowAnchor({ icon, color, label, detail, aside, className, ...rest }, ref) {
    return (
      <a
        ref={ref}
        className={cn(
          "group flex min-h-[64px] items-center gap-3.5 border-b border-line-subtle px-5 py-3 text-ink no-underline transition-colors duration-150 last:border-b-0 hover:bg-surface-inset hover:text-ink max-sm:px-4",
          className,
        )}
        {...rest}
      >
        <span
          aria-hidden
          className="flex size-9 flex-none items-center justify-center rounded-[10px]"
          style={{ background: alpha(color, 0.16), color }}
        >
          <Icon name={icon} size={19} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-semibold">{label}</span>
          {detail && (
            <span className="line-clamp-2 text-[13px] text-pretty text-ink-muted sm:line-clamp-1">{detail}</span>
          )}
        </span>
        {aside && <span className="flex flex-none items-center text-[13px] text-ink-muted">{aside}</span>}
        <Icon
          name="chevR"
          size={18}
          className="flex-none text-ink-faint transition-transform duration-150 group-hover:translate-x-0.5"
        />
      </a>
    );
  },
);

const CreatedSettingsRow = createLink(RowAnchor);

/** A row in a settings group that opens its page: a coloured icon, its name, what's set, and a chevron. */
export const SettingsRow: LinkComponent<typeof RowAnchor> = (props) => (
  <CreatedSettingsRow preload="intent" {...props} />
);
