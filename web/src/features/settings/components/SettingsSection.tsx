import { useId, type CSSProperties, type ReactNode } from "react";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Button } from "~/features/common/ui/components/Button";
import { Card } from "~/features/common/ui/components/Card";
import { HelpText, Input } from "~/features/common/ui/components/Field";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";

/*
 * The settings pages' parts, in the dashboard's own look: a summary at the top (SummaryCard), then sections as the
 * dashboard's cards, choices as tiles to tap (as Battery's Control has), and switches in a sunken panel of rows.
 */

/** A section of a settings page: a dashboard card with its title, a line under it, and on the right an `aside`. */
export function SettingsSection({
  id,
  title,
  sub,
  aside,
  className,
  children,
}: {
  id: string;
  title: ReactNode;
  sub?: ReactNode;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card aria-labelledby={id} className={className}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-[min(100%,18rem)] flex-1 flex-col gap-0.5">
          <h2 id={id}>{title}</h2>
          {sub && <div className="text-[13px] leading-5 text-pretty text-ink-muted">{sub}</div>}
        </div>
        {aside}
      </div>
      {children}
    </Card>
  );
}

export type ChoiceTile<T extends string> = {
  value: T;
  title: ReactNode;
  sub?: ReactNode;
  icon?: IconName;
  /** A picture of the choice in place of the icon: the house in that style, the theme's colours. */
  preview?: ReactNode;
  /** The tile's own colour when chosen, else the group's. */
  color?: string;
};

/**
 * One of a few choices, as tiles: each its icon (or a picture of it), name and a line, the chosen one washed and ringed
 * in `color`. `min`: the narrowest a tile gets before they wrap; on a phone they're `phone` across.
 */
export function ChoiceTiles<T extends string>({
  label,
  options,
  value,
  onChange,
  color = COLOR.brand,
  min = "9.5rem",
  phone = 2,
  rows,
  disabled,
  className,
}: {
  label: string;
  options: ChoiceTile<T>[];
  value: T;
  onChange: (v: T) => void;
  color?: string;
  min?: string;
  /** How many across on a phone. */
  phone?: 1 | 2 | 3;
  /** One under another, each its icon beside its name: for a narrow column. */
  rows?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        rows
          ? "flex flex-col gap-2"
          : "grid [grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--tile-min)),1fr))] gap-3 max-sm:gap-2",
        !rows && (phone === 1 ? "max-sm:grid-cols-1" : phone === 3 ? "max-sm:grid-cols-3" : "max-sm:grid-cols-2"),
        className,
      )}
      style={{ "--tile-min": min } as CSSProperties}
    >
      {options.map((o) => {
        const on = o.value === value;
        const c = o.color ?? color;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => !on && onChange(o.value)}
            className={cn(
              "relative flex min-w-0 overflow-hidden rounded-2xl border text-left transition-[border-color,background-color,transform] duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
              rows ? "flex-row items-center gap-3.5 p-3.5 pr-11" : "flex-col items-start gap-3",
              !rows && (o.preview ? "p-1.5 pb-3" : "p-4 max-sm:p-3.5"),
              on ? "border-transparent" : "border-line-subtle bg-canvas/60 hover:border-line light:bg-canvas",
            )}
            style={on ? { background: alpha(c, 0.14), boxShadow: `inset 0 0 0 2px ${c}` } : undefined}
          >
            {o.preview ? (
              <span className="relative block w-full overflow-hidden rounded-[12px]">{o.preview}</span>
            ) : (
              o.icon && (
                <span
                  className="flex size-10 items-center justify-center rounded-full max-sm:size-9"
                  style={{ background: alpha(c, 0.18), color: c }}
                >
                  <Icon name={o.icon} size={18} />
                </span>
              )
            )}
            <span className={cn("flex min-w-0 flex-col gap-0.5", !!o.preview && "px-2")}>
              <span className="text-[15px] font-semibold text-ink max-sm:text-sm">{o.title}</span>
              {o.sub && <span className="text-xs text-pretty text-ink-muted">{o.sub}</span>}
            </span>
            {on && (
              <span
                aria-hidden
                className={cn(
                  "absolute right-3 flex size-5 animate-pop items-center justify-center rounded-full",
                  rows ? "top-1/2 -translate-y-1/2" : "top-3",
                )}
                style={{ background: c, color: "var(--color-canvas)" }}
              >
                <Icon name="check" size={13} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Rows of settings in a sunken panel, a line between them: each a switch or a small choice (OptionRow). */
export function OptionList({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-col divide-y divide-line-subtle overflow-hidden rounded-2xl bg-canvas/60 light:bg-canvas",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A setting in an OptionList: its name and a line of help, its control on the right (wrapping under on a phone). */
export function OptionRow({
  label,
  help,
  icon,
  color,
  id,
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  icon?: IconName;
  color?: string;
  /** The label's id, for the control's aria-labelledby. */
  id?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3.5">
      <div className="flex max-w-[620px] min-w-[160px] flex-1 items-center gap-3 max-sm:min-w-0">
        {icon && (
          <span
            aria-hidden
            className="flex size-8 flex-none items-center justify-center rounded-full"
            style={{ background: alpha(color ?? COLOR.inkMuted, 0.16), color: color ?? COLOR.inkMuted }}
          >
            <Icon name={icon} size={16} />
          </span>
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          <span id={id} className="text-[15px] font-semibold text-ink">
            {label}
          </span>
          {help && <span className="text-[13px] leading-5 text-pretty text-ink-muted">{help}</span>}
        </div>
      </div>
      {children}
    </div>
  );
}

/** A form's save button, with what went wrong beside it. */
export function SaveBar({
  label,
  pending,
  disabled,
  error,
}: {
  label: string;
  pending: boolean;
  disabled?: boolean;
  error?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" size="sm" disabled={disabled || pending}>
        {pending ? "Saving…" : label}
      </Button>
      <HelpText tone="bad" role="alert">
        {error}
      </HelpText>
    </div>
  );
}

/**
 * A settings page's two halves from a wide screen: a picture of what's set on the left, and the options on the right,
 * both scrolling with the page. Stacked, picture first, where there isn't room.
 */
export function SettingsSplit({ visual, children }: { visual: ReactNode; children: ReactNode }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-1 items-start gap-5 @4xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">{visual}</div>
        <div className="flex min-w-0 flex-col gap-5">{children}</div>
      </div>
    </div>
  );
}

/**
 * A number setting in an OptionList: its name and a line of help on the left, a small box for it on the right.
 */
export function NumberRow({
  label,
  help,
  unit,
  prefix,
  step = "0.1",
  placeholder,
  value,
  onChange,
  type = "number",
}: {
  label: ReactNode;
  help?: ReactNode;
  unit?: string;
  prefix?: string;
  step?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  type?: "number" | "date";
}) {
  const id = useId();
  return (
    <OptionRow id={id} label={label} help={help}>
      <Input
        aria-labelledby={id}
        type={type}
        inputMode={type === "number" ? "decimal" : undefined}
        step={type === "number" ? step : undefined}
        min="0"
        prefix={prefix}
        unit={unit}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        boxClassName={cn(
          "h-10 bg-surface light:bg-surface",
          type === "date" ? "w-[10.5rem] max-sm:w-[9.5rem]" : "w-[8.5rem] max-sm:w-[7rem]",
        )}
        className="text-right"
      />
    </OptionRow>
  );
}

/**
 * What's changed and not saved yet: a line at the foot of the section, under a hairline, while there's something to
 * save (or a save that failed), with Discard and Save. It sits in the page, where the changes are, not over it.
 */
export function SaveBanner({
  dirty,
  pending,
  error,
  onSave,
  onDiscard,
  saveLabel = "Save",
  what = "Unsaved changes",
}: {
  dirty: boolean;
  pending: boolean;
  error?: ReactNode;
  onSave: () => void;
  onDiscard: () => void;
  saveLabel?: string;
  what?: ReactNode;
}) {
  if (!dirty && !error) return null;
  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      className="flex animate-fade flex-wrap items-center gap-x-3 gap-y-2.5 border-t border-line-subtle pt-4"
    >
      <span className={cn("min-w-0 flex-1 text-[13px]", error ? "text-bad" : "text-ink-muted")} role="status">
        {error || what}
      </span>
      <Button variant="muted-link" size="md" className="px-2" disabled={pending || !dirty} onClick={onDiscard}>
        Discard
      </Button>
      <Button size="sm" disabled={pending || !dirty} onClick={onSave}>
        {pending ? "Saving…" : saveLabel}
      </Button>
    </div>
  );
}
