import { useEffect, useState, type InputHTMLAttributes, type KeyboardEvent } from "react";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Input } from "~/features/common/ui/components/Field";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";

/** The set-up code's length, without its dash (ABCD-EFGH). */
export const CODE_LENGTH = 8;

/** The code as typed or pasted: capitals and digits only, at most CODE_LENGTH of them. */
export const cleanCode = (v: string) =>
  v
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, CODE_LENGTH);

/**
 * The set-up code as eight boxes in two fours, filling as it's typed or pasted. One real input sits over them all
 * (invisible), so typing, pasting, autofill and screen readers work as they would with any text box; the boxes just
 * show it, with a caret in the next one to fill. Once it's whole the boxes turn green.
 */
export function CodeInput({
  value,
  onChange,
  invalid,
  autoFocus,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  autoFocus?: boolean;
  id?: string;
}) {
  const [focused, setFocused] = useState(false);
  const whole = value.length === CODE_LENGTH;
  const cell = (k: number) => {
    const ch = value[k];
    const here = focused && k === value.length;
    return (
      <span
        key={k}
        className={cn(
          "relative flex h-14 min-w-0 flex-1 items-center justify-center rounded-xl border font-mono text-[22px] font-medium transition-[border-color,box-shadow,background-color] duration-150 max-2xs:h-12 max-2xs:text-lg",
          invalid
            ? "border-bad"
            : here
              ? "border-brand shadow-focus"
              : whole
                ? "border-transparent"
                : "border-line-subtle",
          !whole && "bg-canvas/60 light:bg-canvas",
        )}
        style={whole && !invalid ? { background: `color-mix(in srgb, ${COLOR.good} 14%, transparent)` } : undefined}
      >
        {ch ? (
          <span key={ch + k} className="animate-pop">
            {ch}
          </span>
        ) : (
          here && <span aria-hidden className="h-6 w-0.5 animate-blink rounded-full bg-brand" />
        )}
      </span>
    );
  };
  return (
    <div className="relative">
      <div aria-hidden className="flex items-center gap-2 max-2xs:gap-1.5">
        {[0, 1, 2, 3].map(cell)}
        <span className="w-2 flex-none text-center text-ink-faint">–</span>
        {[4, 5, 6, 7].map(cell)}
      </div>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(cleanCode(e.target.value))}
        onFocus={(e) => {
          setFocused(true);
          // Always add at the end: the boxes have no caret of their own to move.
          const end = e.target.value.length;
          e.target.setSelectionRange(end, end);
        }}
        onBlur={() => setFocused(false)}
        autoComplete="one-time-code"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        className="absolute inset-0 size-full cursor-text border-0 bg-transparent text-base text-transparent caret-transparent opacity-0 outline-0 selection:bg-transparent"
      />
    </div>
  );
}

/**
 * A password box with an eye to show what's typed, and a word under it when Caps Lock is on. Extra props go to the
 * input.
 */
export function PasswordInput({
  value,
  onChange,
  invalid,
  ...rest
}: { value: string; onChange: (v: string) => void; invalid?: boolean } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
>) {
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  const checkCaps = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.("CapsLock") ?? false);
  return (
    <span className="flex flex-col gap-1.5">
      <Input
        {...rest}
        type={shown ? "text" : "password"}
        value={value}
        invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={checkCaps}
        onKeyUp={checkCaps}
        onBlur={() => setCaps(false)}
        spellCheck={false}
        autoCapitalize="none"
        boxClassName="pr-1.5"
        unit={
          <button
            type="button"
            aria-label={shown ? "Hide password" : "Show password"}
            aria-pressed={shown}
            // Keep the focus (and the caret) in the box.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShown((s) => !s)}
            className="flex size-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-fg/5 hover:text-ink"
          >
            <Icon name={shown ? "eyeOff" : "eye"} size={17} />
          </button>
        }
      />
      {caps && (
        <span className="flex animate-pop items-center gap-1.5 text-xs text-warn">
          <Icon name="capsLock" size={13} />
          Caps Lock is on
        </span>
      )}
    </span>
  );
}

const STRENGTH = [
  { label: "", color: COLOR.track },
  { label: "Too short", color: COLOR.bad },
  { label: "Okay", color: COLOR.warn },
  { label: "Good", color: COLOR.good },
  { label: "Strong", color: COLOR.good },
] as const;

/**
 * How hard a password would be to guess, from 1 (too short to use) to 4: long, or a mix of capitals, digits and
 * symbols, scores higher. A rough guide, not a rule: only the length is enforced.
 */
export function passwordStrength(p: string, min: number): 0 | 1 | 2 | 3 | 4 {
  if (!p) return 0;
  if (p.length < min) return 1;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  if (p.length >= 16 || (p.length >= 12 && kinds >= 3)) return 4;
  if (p.length >= 12 || kinds >= 3) return 3;
  return 2;
}

/** Four bars filling in the strength's colour as the password gets harder to guess, its word beside them. */
export function StrengthMeter({ password, min }: { password: string; min: number }) {
  const s = passwordStrength(password, min);
  const { label, color } = STRENGTH[s];
  return (
    <span className="flex items-center gap-3" aria-live="polite">
      <span aria-hidden className="flex flex-1 gap-1">
        {[1, 2, 3, 4].map((k) => (
          <span key={k} className="h-1 flex-1 overflow-hidden rounded-full bg-track">
            <span
              className="block h-full origin-left rounded-full transition-[transform,background-color] duration-300 ease-out"
              style={{ background: color, transform: `scaleX(${s >= k ? 1 : 0})` }}
            />
          </span>
        ))}
      </span>
      <span
        className="min-w-16 text-right text-xs font-medium whitespace-nowrap"
        style={{ color: s ? color : undefined }}
      >
        {s ? label : `${min}+ characters`}
      </span>
    </span>
  );
}

/** A tick and a word for whether the confirmation matches, once there's something to compare. */
export function MatchHint({ password, confirm }: { password: string; confirm: string }) {
  if (!confirm) return null;
  const same = confirm === password;
  // Still typing it: say nothing until it's as long as the password, or already off.
  if (!same && password.startsWith(confirm)) return null;
  return (
    <span className={cn("flex animate-pop items-center gap-1.5 text-xs", same ? "text-good" : "text-bad")}>
      <Icon name={same ? "check" : "x"} size={13} />
      {same ? "Passwords match" : "Doesn't match yet"}
    </span>
  );
}

/** Copies `text`, saying so for a moment. Hidden where the browser won't allow it (a page not served over https). */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);
  if (typeof navigator === "undefined" || !navigator.clipboard || !window.isSecureContext) return null;
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => setDone(true),
          () => {},
        )
      }
      className="flex flex-none items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-fg/5 hover:text-ink"
    >
      <Icon name={done ? "check" : "copy"} size={13} />
      {done ? "Copied" : label}
    </button>
  );
}
