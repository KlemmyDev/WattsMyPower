import type { ReactNode } from "react";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";

/** A centred message with an icon, heading and call to action. */
export function EmptyState({
  icon,
  title,
  id,
  children,
  action,
}: {
  icon: IconName;
  title: string;
  id?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col items-center gap-4 rounded-2xl border border-line-subtle bg-surface px-6 py-16 text-center"
    >
      <div className="flex size-16 items-center justify-center rounded-full bg-canvas text-ink">
        <Icon name={icon} size={24} />
      </div>
      <h2 id={id} className="font-sans text-[32px] leading-10 font-normal tracking-[-0.5px]">
        {title}
      </h2>
      <p className="m-0 max-w-[520px] text-[15px] leading-6 text-pretty text-ink-muted">{children}</p>
      {action}
    </section>
  );
}
