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
  /** The pill shows it needs a look (signed out, not updating). */
  attention?: boolean;
  detail: ReactNode;
  /** Small tags under the detail: how it's read ("On your network"), "Untested". */
  tags?: ReactNode;
  /** A card of its own (in a grid of them), rather than a row in a settings card. */
  card?: boolean;
  /** Not set up yet: a flat tile, dashed, that says Connect rather than opening with a chevron. */
  connect?: boolean;
};

const ROW = "flex items-center gap-4 border-b border-line-subtle px-6 py-5 last:border-b-0 max-sm:px-5";
const CARD =
  "flex items-center gap-4 rounded-3xl border border-line-subtle glass p-6 transition-[translate,border-color,background-color] duration-200 ease-out-soft max-sm:rounded-[20px] max-sm:p-5";
const CONNECT =
  "flex items-center gap-4 rounded-2xl border border-dashed border-line bg-transparent px-5 py-4 transition-[border-color,background-color] duration-200 ease-out-soft hover:border-solid hover:border-line-strong";

/** Icon, name with a status pill, and a line of detail. */
function TileBody({ icon, name, status, on, attention, detail, tags, connect }: TileProps) {
  return (
    <>
      <div
        className={cn(
          "flex flex-none items-center justify-center rounded-full bg-canvas",
          connect ? "size-9 text-ink-muted" : "size-11 text-ink",
        )}
      >
        <Icon name={icon} size={connect ? 18 : 22} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-semibold">
          {name}
          {status && (
            <Pill tone={on ? "ok" : attention ? "bad" : "neutral"} size="sm">
              {status}
            </Pill>
          )}
        </div>
        <span className="text-[13px] text-pretty text-ink-muted">{detail}</span>
        {tags && <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">{tags}</span>}
      </div>
    </>
  );
}

const TileAnchor = forwardRef<HTMLAnchorElement, TileProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children">>(
  function TileAnchor({ icon, name, status, on, attention, detail, tags, card, connect, className, ...rest }, ref) {
    return (
      <a
        ref={ref}
        className={cn(
          connect
            ? CONNECT
            : card
              ? cn(CARD, "hover:-translate-y-0.5 hover:border-line-strong active:translate-y-0")
              : ROW,
          "text-ink no-underline hover:bg-surface-inset hover:text-ink",
          className,
        )}
        {...rest}
      >
        <TileBody
          icon={icon}
          name={name}
          status={status}
          on={on}
          attention={attention}
          detail={detail}
          tags={tags}
          connect={connect}
        />
        {connect ? (
          <span className="flex flex-none items-center gap-1 text-[13px] font-semibold text-brand">
            <Icon name="plus" size={15} />
            Connect
          </span>
        ) : (
          <Icon name="chevR" size={18} className="text-ink-faint" />
        )}
      </a>
    );
  },
);

const CreatedIntegrationLink = createLink(TileAnchor);

/** A row in a settings card that opens a page a level down, with a chevron on the right. */
export const IntegrationLink: LinkComponent<typeof TileAnchor> = (props) => (
  <CreatedIntegrationLink preload="intent" {...props} />
);
