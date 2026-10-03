import { createLink, type LinkComponent } from "@tanstack/react-router";
import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { Pill } from "~/features/common/ui/components/Pill";
import { cn } from "~/features/common/ui/utils";

type TileProps = {
  icon: IconName;
  name: ReactNode;
  /** The status pill's text, if it has one. */
  status?: string;
  /** The pill shows it as working. */
  on?: boolean;
  detail: ReactNode;
  /** A card of its own (in a grid of them), rather than a row in a settings card. */
  card?: boolean;
};

const ROW = "flex items-center gap-4 border-b border-line-subtle px-6 py-5 last:border-b-0 max-sm:px-5";
const CARD =
  "flex items-center gap-4 rounded-3xl border border-line-subtle bg-surface p-6 transition-colors max-sm:rounded-[20px] max-sm:p-5";

/** Icon, name with a status pill, and a line of detail. */
function TileBody({ icon, name, status, on, detail }: TileProps) {
  return (
    <>
      <div className="flex size-11 flex-none items-center justify-center rounded-full bg-canvas text-ink">
        <Icon name={icon} size={22} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-semibold">
          {name}
          {status && (
            <Pill tone={on ? "ok" : "neutral"} size="sm">
              {status}
            </Pill>
          )}
        </div>
        <span className="text-[13px] text-pretty text-ink-muted">{detail}</span>
      </div>
    </>
  );
}

const TileAnchor = forwardRef<HTMLAnchorElement, TileProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children">>(
  function TileAnchor({ icon, name, status, on, detail, card, className, ...rest }, ref) {
    return (
      <a
        ref={ref}
        className={cn(
          card ? cn(CARD, "hover:border-line-strong") : ROW,
          "text-ink no-underline hover:bg-surface-inset hover:text-ink",
          className,
        )}
        {...rest}
      >
        <TileBody icon={icon} name={name} status={status} on={on} detail={detail} />
        <Icon name="chevR" size={18} className="text-ink-faint" />
      </a>
    );
  },
);

const CreatedIntegrationLink = createLink(TileAnchor);

/** A row in a settings card that opens a page a level down, with a chevron on the right. */
export const IntegrationLink: LinkComponent<typeof TileAnchor> = (props) => (
  <CreatedIntegrationLink preload="intent" {...props} />
);

/** The same row, for something that can't be opened yet. */
export function IntegrationTile({ card, ...props }: TileProps) {
  return (
    <div className={card ? CARD : ROW}>
      <TileBody {...props} />
    </div>
  );
}
