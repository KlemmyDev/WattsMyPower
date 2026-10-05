import { useId, useState, type KeyboardEvent } from "react";
import { Input } from "~/features/common/ui/components/Field";
import { cn } from "~/features/common/ui/utils";

type Option = { value: string | null; label: string; hint?: string };

const tidy = (s: string) => s.trim().replace(/\s+/g, " ");
const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/**
 * The group a device is in, typed or picked: the groups there are (matching what's typed), a new one by what's typed,
 * the one its name suggests ("Study" for "Study (Left)"), or none. Saved when one's picked, or on leaving the box;
 * Escape puts it back as it was. Remount it (by `key`) when `value` changes from outside.
 */
export function GroupInput({
  value,
  groups,
  suggestion,
  disabled,
  onChange,
  className,
}: {
  value: string | null;
  /** Every group there is, with how many devices are in it. */
  groups: Map<string, number>;
  suggestion: string | null;
  disabled?: boolean;
  onChange: (group: string | null) => void;
  className?: string;
}) {
  const id = useId();
  const [text, setText] = useState(value ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typed = tidy(text);
  const changed = typed !== tidy(value ?? "");

  const options: Option[] = [];
  const word = (n: number) => `${n} device${n === 1 ? "" : "s"}`;
  const there = [...groups].filter(
    ([g]) => !changed || !typed || g.toLocaleLowerCase().includes(typed.toLocaleLowerCase()),
  );
  // The group its name suggests first, if it's there already.
  there.sort(([a], [b]) => Number(!!suggestion && same(b, suggestion)) - Number(!!suggestion && same(a, suggestion)));
  for (const [g, n] of there) options.push({ value: g, label: g, hint: g === value ? "In it" : word(n) });
  if (changed && typed && !there.some(([g]) => same(g, typed)))
    options.push({ value: typed, label: `New group “${typed}”` });
  if ((!changed || !typed) && suggestion && ![...groups.keys()].some((g) => same(g, suggestion)))
    options.unshift({ value: suggestion, label: `New group “${suggestion}”`, hint: "From its name" });
  if (value) options.push({ value: null, label: "No group", hint: "On its own" });
  const shown = open && options.length > 0;
  const at = Math.min(active, options.length - 1);

  const pick = (next: string | null) => {
    const group = next ? tidy(next) : null;
    setText(group ?? "");
    setOpen(false);
    if ((group ?? "") !== (value ?? "")) onChange(group);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((at + step + options.length) % options.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(shown ? options[at].value : typed);
    } else if (e.key === "Escape" && (open || changed)) {
      e.preventDefault();
      setText(value ?? "");
      setOpen(false);
    }
  };

  return (
    <div className={cn("relative", className)}>
      <Input
        role="combobox"
        aria-label="Group"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={`${id}-list`}
        aria-activedescendant={shown ? `${id}-${at}` : undefined}
        placeholder="Add to a group"
        value={text}
        maxLength={60}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => pick(typed || null)}
        onKeyDown={onKeyDown}
      />
      {shown && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label="Groups"
          className="absolute top-full left-0 z-10 m-0 mt-1 flex max-h-64 w-max max-w-[300px] min-w-full animate-pop list-none flex-col overflow-auto rounded-lg border border-line bg-popover p-1 shadow-pop"
        >
          {options.map((o, i) => (
            <li
              key={o.value ?? ""}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === at}
              // Picked before the box loses focus (which would save what's typed instead).
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o.value)}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-4 rounded-md px-2.5 py-2 text-sm",
                i === at && "bg-surface-raised",
                o.value === null && "text-ink-muted",
              )}
            >
              <span className="truncate">{o.label}</span>
              {o.hint && <span className="text-xs whitespace-nowrap text-ink-faint">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
