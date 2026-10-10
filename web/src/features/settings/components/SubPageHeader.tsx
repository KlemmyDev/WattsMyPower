import { createLink, type LinkComponent } from "@tanstack/react-router";
import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { buttonClass } from "~/features/common/ui/components/Button";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { SettingsTitle } from "~/features/settings/components/SettingsCard";

const BackAnchor = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement>>(function BackAnchor(
  { className, children, ...rest },
  ref,
) {
  return (
    <a ref={ref} className={buttonClass("muted-link", "md", cn("-ml-1 gap-0.5 self-start", className))} {...rest}>
      <Icon name="chevL" size={18} />
      {children}
    </a>
  );
});

const CreatedBackLink = createLink(BackAnchor);

/** A link back up a level, with a chevron: <BackLink to="/integrations">Integrations</BackLink>. */
export const BackLink: LinkComponent<typeof BackAnchor> = (props) => <CreatedBackLink preload="intent" {...props} />;

/**
 * The top of one of Settings' pages: a small way back over the page's own title, as large as any page's, and its line
 * of explanation (as Bills' Rates & settings has).
 */
export function SettingsPageHeader({ title, sub }: { title: ReactNode; sub: ReactNode }) {
  return (
    <>
      <div className="pt-2">
        <BackLink to="/settings">Settings</BackLink>
      </div>
      <PageHeader title={title} sub={sub} />
    </>
  );
}

/** The top of a settings page a level down: the way back, its title, and a line of explanation. */
export function SubPageHeader({
  back,
  id,
  title,
  sub,
}: {
  back: ReactNode;
  id: string;
  title: ReactNode;
  sub: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 pt-1">
      {back}
      <SettingsTitle id={id} title={title} sub={sub} />
    </div>
  );
}
