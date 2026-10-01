import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { cn } from "~/features/common/ui/utils";

/** A labelled form control with optional help text and error. */
export function Field({
  label,
  help,
  error,
  className,
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[13px] font-semibold">{label}</span>
      {children}
      {help && <span className="text-xs text-ink-muted">{help}</span>}
      {error && <span className="text-xs text-bad">{error}</span>}
    </label>
  );
}

export function HelpText({ tone, className, ...rest }: { tone?: "bad" } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("text-xs empty:hidden", tone === "bad" ? "text-bad" : "text-ink-muted", className)} {...rest} />
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  prefix?: ReactNode;
  unit?: ReactNode;
  invalid?: boolean;
  boxClassName?: string;
};

/** A text input in the standard box, with an optional "$" prefix and unit suffix. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { prefix, unit, invalid, boxClassName, className, ...rest },
  ref,
) {
  return (
    <span
      className={cn(
        "flex h-11 items-center gap-2 rounded-lg border bg-surface px-3.5 focus-within:border-brand focus-within:shadow-focus",
        invalid ? "border-bad" : "border-line",
        boxClassName,
      )}
    >
      {prefix && <span className="font-medium text-ink-muted">{prefix}</span>}
      <input
        ref={ref}
        className={cn(
          "min-w-0 flex-1 border-0 bg-transparent font-sans text-base leading-none text-ink tabular-nums outline-0 focus-visible:shadow-none",
          className,
        )}
        {...rest}
      />
      {unit && <span className="text-[13px] whitespace-nowrap text-ink-faint">{unit}</span>}
    </span>
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        "h-11 rounded-lg border border-line bg-surface px-3 font-sans text-[15px] text-ink focus:border-brand focus:shadow-focus focus:outline-none",
        className,
      )}
      {...rest}
    />
  );
});

/** Stable id for aria wiring. */
export const useFieldId = useId;
