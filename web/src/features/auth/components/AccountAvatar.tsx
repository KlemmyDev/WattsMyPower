import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { sessionQuery } from "~/features/auth/api";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";

/**
 * The way to the account, in the top right corner: the signed-in name's first letter in a circle (a person, when the
 * server doesn't ask anyone to sign in). Ringed while the account page is open.
 */
export function AccountAvatar({ className }: { className?: string }) {
  const name = useQuery(sessionQuery).data?.username?.trim();
  const label = name ? `Account, signed in as ${name}` : "Account";
  return (
    <Link
      to="/account"
      aria-label={label}
      title={label}
      className={cn(
        "flex size-10 flex-none items-center justify-center rounded-full border border-fg/8 bg-chip font-display text-[15px] font-semibold text-ink-soft no-underline transition-[color,border-color,box-shadow,scale] duration-200 hover:border-fg/20 hover:text-ink active:scale-95 aria-[current=page]:border-transparent aria-[current=page]:text-ink aria-[current=page]:ring-2 aria-[current=page]:ring-ink/70",
        className,
      )}
    >
      {name ? <span aria-hidden>{name.charAt(0).toUpperCase()}</span> : <Icon name="user" size={18} />}
    </Link>
  );
}
