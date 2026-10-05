import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Input } from "~/features/common/ui/components/Field";
import { cn } from "~/features/common/ui/utils";

type Option = { value: string | null; label: string; hint?: string };

/** Where the list goes, on the page: under the box, or over it when there's more room above. */
type Place = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

const LIST_MAX = 256; // px

function placeUnder(box: DOMRect): Place {
  const below = window.innerHeight - box.bottom - 8;
  const above = box.top - 8;
  const up = below < Math.min(LIST_MAX, 160) && above > below;
  return {
    left: box.left,
    width: box.width,
    ...(up ? { bottom: window.innerHeight - box.top + 4 } : { top: box.bottom + 4 }),
    maxHeight: Math.max(120, Math.min(LIST_MAX, (up ? above : below) - 4)),
  };
}

const tidy = (s: string) => s.trim().replace(/\s+/g, " ");
const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/**
 * The group a device is in, typed or picked: the groups there are (matching what's typed), a new one by what's typed,
 * the one its name suggests ("Study" for "Study (Left)"), or none. Saved when one's picked, or on leaving the box;
 * Escape puts it back as it was. Remount it (by `key`) when `value` changes from outside.
 *
 * The list is drawn over the page (a portal), placed by the box, so a card that clips what overflows it (the device
 * list's rounded corners) doesn't cut it off; it follows the box as the page scrolls.
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
  const [place, setPlace] = useState<Place | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const typed = tidy(text);
  const measure = useCallback(() => {
    if (box.current) setPlace(placeUnder(box.current.getBoundingClientRect()));
  }, []);
  const show = () => {
    measure();
    setOpen(true);
  };
  // While it's open, keep it by the box as anything scrolls or the window changes size.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, measure]);
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
  const shown = open && options.length > 0 && place != null;
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
      if (!open) return show();
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
    <div ref={box} className={cn("relative", className)}>
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
          show();
          setActive(0);
        }}
        onFocus={show}
        onClick={show}
        onBlur={() => pick(typed || null)}
        onKeyDown={onKeyDown}
      />
      {shown &&
        createPortal(
          <ul
            id={`${id}-list`}
            role="listbox"
            aria-label="Groups"
            style={{
              left: place.left,
              minWidth: place.width,
              top: place.top,
              bottom: place.bottom,
              maxHeight: place.maxHeight,
            }}
            className="fixed z-50 m-0 flex w-max max-w-[300px] animate-pop list-none flex-col overflow-auto rounded-lg border border-line bg-popover p-1 shadow-pop"
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
          </ul>,
          document.body,
        )}
    </div>
  );
}
