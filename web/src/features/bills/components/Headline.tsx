import type { ReactNode } from "react";
import { BigNumber, Eyebrow, Muted } from "~/features/common/ui/components/Card";

/** A card's lead figure: small label, big number, and a sentence about it. */
export function Headline({
  id,
  label,
  value,
  note,
}: {
  id: string;
  label: ReactNode;
  value: ReactNode;
  note: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Eyebrow id={id}>{label}</Eyebrow>
      <BigNumber>{value}</BigNumber>
      <Muted>{note}</Muted>
    </div>
  );
}
