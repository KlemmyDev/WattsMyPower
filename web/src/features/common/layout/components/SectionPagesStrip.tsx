import { Link, useRouterState } from "@tanstack/react-router";
import { useRef } from "react";
import { usePillIndicator, useSectionPages } from "~/features/common/layout/hooks";
import { sectionOf } from "~/features/common/layout/utils";
import { Icon } from "~/features/common/ui/components/Icon";

// A section's pages say for themselves which is current (a room is, on its devices' pages). Their links only count
// themselves current on their exact page, so a link up the path ("/home") doesn't light up as well.
const EXACT = { exact: true, includeSearch: false } as const;

const PILL =
  "relative z-1 flex h-9 flex-none items-center gap-2 rounded-full px-4 text-sm font-medium whitespace-nowrap text-ink-muted no-underline transition-[color,transform] duration-[260ms,160ms] hover:text-ink active:scale-95 aria-[current=page]:text-ink-inverse aria-[current=page]:hover:text-ink-inverse max-sm:px-3";

/**
 * The current section's pages, with their readings, as a row of pills at the top of the page below xl: there, the side
 * nav is a rail or a menu of the sections alone, so (as the column beside the collapsed rail does on a desktop) this
 * keeps them in view. Nothing for a section without pages.
 */
export function SectionPagesStrip() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const pages = useSectionPages(sectionOf(path));
  const row = useRef<HTMLElement>(null);
  // The highlight slides under the current page, as it did under Settings' tabs.
  const ind = usePillIndicator(row, [path, pages?.pages.length]);
  if (!pages) return null;
  return (
    // The row scrolls sideways on its own when it doesn't fit, not the page.
    <nav
      ref={row}
      aria-label={`${pages.title} pages`}
      className="relative flex max-w-full [scrollbar-width:none] items-center gap-0.5 self-start overflow-x-auto overscroll-x-contain rounded-full border border-chip-line bg-chip p-1 xl:hidden [&::-webkit-scrollbar]:hidden"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute top-1 bottom-1 rounded-full bg-ink transition-[left,width,opacity] duration-[380ms,380ms,200ms] ease-spring"
        style={{ left: ind?.left ?? 4, width: ind?.width ?? 0, opacity: ind ? 1 : 0 }}
      />
      {pages.root && (
        <Link
          {...pages.root.link}
          activeOptions={EXACT}
          aria-current={pages.root.active ? "page" : undefined}
          className={PILL}
        >
          {pages.root.label}
        </Link>
      )}
      {pages.pages.map((p) => (
        <Link
          key={p.key}
          {...p.link}
          activeOptions={EXACT}
          aria-current={p.active ? "page" : undefined}
          className={PILL}
        >
          {p.icon ? (
            <Icon name={p.icon} size={16} />
          ) : (
            p.color && <span aria-hidden className="size-2 flex-none rounded-full" style={{ background: p.color }} />
          )}
          {p.label}
          {p.value && <span className="text-xs font-normal tabular-nums opacity-55">{p.value}</span>}
        </Link>
      ))}
    </nav>
  );
}
