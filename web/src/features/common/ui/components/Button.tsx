import { createLink, type LinkComponent } from "@tanstack/react-router";
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from "react";
import { cn } from "~/features/common/ui/utils";

export type ButtonVariant = "primary" | "outline" | "link" | "muted-link" | "chip" | "round" | "icon";
export type ButtonSize = "sm" | "md" | "lg";

const base = "inline-flex items-center gap-2 font-semibold no-underline transition-colors";

const variants: Record<ButtonVariant, string> = {
  primary:
    "rounded-full border-0 bg-ink text-ink-inverse hover:bg-[#d4d4d4] hover:text-ink-inverse disabled:bg-surface-raised disabled:text-ink-faint",
  outline:
    "rounded-full border border-line bg-surface text-ink hover:bg-canvas hover:text-ink disabled:border-transparent disabled:bg-surface-raised disabled:text-ink-faint",
  link: "border-0 bg-transparent p-0 text-link hover:text-link-hover",
  "muted-link": "border-0 bg-transparent p-0 font-medium text-ink-muted hover:text-ink",
  chip: "rounded-full border border-line px-3 py-[5px] text-xs whitespace-nowrap text-ink-muted hover:border-white/25 hover:text-ink",
  round:
    "size-9 justify-center rounded-full border border-line bg-transparent p-0 text-ink hover:border-white/25 disabled:cursor-default disabled:border-white/5 disabled:text-grey-400",
  icon: "size-8 justify-center rounded-full border border-line bg-surface p-0 text-lg leading-none font-normal text-ink-muted hover:bg-canvas hover:text-ink",
};

const sizes: Record<ButtonVariant, Record<ButtonSize, string>> = {
  primary: { sm: "px-[18px] py-2.5 text-sm", md: "px-5 py-3 text-[15px]", lg: "px-6 py-3.5 text-base" },
  outline: { sm: "px-[18px] py-2.5 text-sm", md: "px-[18px] py-2.5 text-sm", lg: "px-5 py-3 text-[15px]" },
  link: { sm: "text-[13px]", md: "text-sm", lg: "text-base" },
  "muted-link": { sm: "text-[13px]", md: "text-sm", lg: "text-base" },
  chip: { sm: "", md: "", lg: "" },
  round: { sm: "", md: "", lg: "" },
  icon: { sm: "", md: "", lg: "" },
};

/** Class names for a button-styled element (also used for links that look like buttons). */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(base, variants[variant], sizes[variant][size], className);
}

type StyleProps = { variant?: ButtonVariant; size?: ButtonSize };

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & StyleProps>(
  function Button({ variant = "primary", size = "md", className, type = "button", ...rest }, ref) {
    return <button ref={ref} type={type} className={buttonClass(variant, size, className)} {...rest} />;
  },
);

const StyledAnchor = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & StyleProps>(
  function StyledAnchor({ variant = "primary", size = "md", className, ...rest }, ref) {
    return <a ref={ref} className={buttonClass(variant, size, className)} {...rest} />;
  },
);

const CreatedButtonLink = createLink(StyledAnchor);

/** A router link styled as a button: <ButtonLink to="/tesla/setup" variant="primary">. */
export const ButtonLink: LinkComponent<typeof StyledAnchor> = (props) => (
  <CreatedButtonLink preload="intent" {...props} />
);
