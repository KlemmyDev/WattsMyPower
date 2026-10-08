import type { ReactNode } from "react";
import { InverterNotice } from "~/features/common/layout/components/InverterNotice";

/**
 * Page title and subtitle at the top of each page, with the inverter warning under it when needed. `action`: a link or
 * button at the end of the subtitle's line (to a page of the section's own), wrapping under it where there's no room.
 */
export function PageHeader({ title, sub, action }: { title: ReactNode; sub: ReactNode; action?: ReactNode }) {
  return (
    <>
      <div className="flex flex-col gap-1 pt-2 pb-1">
        {/* From tablets up, clear of the live clock and the account in the top right corner, on the title's line. */}
        <h1 className="md:pr-64">{title}</h1>
        {action ? (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="font-display text-base leading-[22px] font-medium text-pretty text-ink-sub">{sub}</div>
            {action}
          </div>
        ) : (
          <div className="font-display text-base leading-[22px] font-medium text-pretty text-ink-sub">{sub}</div>
        )}
      </div>
      <InverterNotice />
    </>
  );
}
