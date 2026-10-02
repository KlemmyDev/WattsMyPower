import type { ReactNode } from "react";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { Pill } from "~/features/common/ui/components/Pill";

/** A connected service in a settings card: icon, name with a status pill, a line of detail, and actions. */
export function IntegrationRow({
  icon,
  name,
  on,
  status,
  detail,
  action,
  children,
}: {
  icon: IconName;
  name: ReactNode;
  on: boolean;
  status: string;
  detail: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-line-subtle px-6 py-5 last:border-b-0">
      <div className="flex size-11 flex-none items-center justify-center rounded-full bg-canvas text-ink">
        <Icon name={icon} size={22} />
      </div>
      <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
          {name}
          <Pill tone={on ? "ok" : "neutral"} size="sm">
            {status}
          </Pill>
        </div>
        <span className="text-[13px] text-ink-muted">{detail}</span>
      </div>
      {action}
      {children}
    </div>
  );
}
