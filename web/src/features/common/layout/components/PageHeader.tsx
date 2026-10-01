import type { ReactNode } from "react";
import { InverterNotice } from "~/features/common/layout/components/InverterNotice";

/** Page title and subtitle at the top of each page, with the inverter warning under it when needed. */
export function PageHeader({ title, sub }: { title: ReactNode; sub: ReactNode }) {
  return (
    <>
      <div className="flex flex-col gap-1 pt-2 pb-1">
        <h1>{title}</h1>
        <div className="font-display text-base leading-[22px] font-medium text-pretty text-[#8f8f94]">{sub}</div>
      </div>
      <InverterNotice />
    </>
  );
}
