import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { reducedMotion } from "~/features/common/display/utils";
import { cn } from "~/features/common/ui/utils";

/** A figure as a number, its sign and its unit: "+12%", "4.6 kW", "74". */
const NUM = /^([+−-]?)(\d+(?:\.\d+)?)(\s?(?:%|kW|kWh)?)$/;

/**
 * Text in the live pages' top card that changes with the page: a figure counts from its old value to its new one, and
 * anything else fades out and back in as the new text. As the day's scrubbed or a reading comes in, it just changes.
 * React draws it once; after that it's written here, so counting doesn't re-render the card.
 */
export function Swap({ text, page, className }: { text: string; page: string; className?: string }) {
  const el = useRef<HTMLSpanElement>(null);
  const [first] = useState(text);
  const last = useRef({ text: first, page });
  useLayoutEffect(() => {
    const node = el.current;
    const was = last.current;
    last.current = { text, page };
    if (!node || was.text === text) return;
    if (was.page === page || reducedMotion()) {
      node.textContent = text;
      return;
    }
    const a = NUM.exec(was.text);
    const b = NUM.exec(text);
    let raf = 0;
    let to = 0;
    if (a && b) {
      const num = (m: RegExpExecArray) => parseFloat(`${m[1] === "+" ? "" : m[1] ? "-" : ""}${m[2]}`);
      const from = num(a);
      const end = num(b);
      const dec = (b[2].split(".")[1] ?? "").length;
      const t0 = performance.now();
      const step = (ms: number) => {
        const k = Math.min(1, (ms - t0) / 650);
        const v = from + (end - from) * (1 - Math.pow(1 - k, 3));
        node.textContent = k < 1 ? `${v < 0 ? "−" : b[1] === "+" ? "+" : ""}${Math.abs(v).toFixed(dec)}${b[3]}` : text;
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    } else {
      node.classList.add("live-swap-out");
      to = window.setTimeout(() => {
        node.textContent = text;
        node.classList.remove("live-swap-out");
      }, 160);
    }
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(to);
      node.classList.remove("live-swap-out");
      node.textContent = text;
    };
  }, [text, page]);
  return (
    <span ref={el} className={cn("live-swap", className)}>
      {first}
    </span>
  );
}

/**
 * What's shown for one page in place of another's: the old fades up and out as the new one rises in, both in one grid
 * cell so nothing moves. Within a page (`k` the same) it just changes.
 */
export function CrossFade({
  k,
  text,
  render,
  className,
}: {
  k: string;
  text: string;
  /** The text drawn: `current` false for the one fading out (keep ids and live regions off it). */
  render: (text: string, current: boolean) => ReactNode;
  className?: string;
}) {
  const [s, setS] = useState({ k, text, old: null as { k: string; text: string } | null });
  if (s.k !== k) setS({ k, text, old: { k: s.k, text: s.text } });
  else if (s.text !== text) setS({ ...s, text });
  return (
    <div className={cn("grid", className)}>
      {s.old && (
        <div key={`old-${s.old.k}`} aria-hidden className="live-out pointer-events-none [grid-area:1/1]">
          {render(s.old.text, false)}
        </div>
      )}
      <div key={`new-${k}`} className={cn("[grid-area:1/1]", s.old && "live-in")}>
        {render(text, true)}
      </div>
    </div>
  );
}
