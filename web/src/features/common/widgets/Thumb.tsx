import { COLOR } from "~/features/common/theme/utils/colors";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import type { Thumb as Spec } from "~/features/common/widgets/types";

/**
 * A widget's small picture, as the list of widgets and its style choices show it: what it looks like, drawn simply,
 * in its own colour, on the quiet inset of its box.
 */
export function Thumb({ thumb, className }: { thumb: Spec; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex flex-none items-center justify-center overflow-hidden rounded-[11px] bg-surface-inset light:bg-fg/5",
        thumb.kind === "scene" &&
          "bg-[linear-gradient(180deg,#d7e5f8,#edf2f9)] light:bg-[linear-gradient(180deg,#d7e5f8,#edf2f9)]",
        className,
      )}
    >
      <Drawing thumb={thumb} />
    </span>
  );
}

function Drawing({ thumb: t }: { thumb: Spec }) {
  switch (t.kind) {
    case "number":
      return (
        <span className="text-[19px] font-light tracking-[-0.5px] tabular-nums" style={{ color: t.color }}>
          {t.value}
        </span>
      );
    case "line":
      return (
        <svg width="64" height="36" viewBox="0 0 64 36">
          <path d="M2 34 C 14 33 20 20 28 10 C 34 3 38 2 42 4 C 50 9 54 26 62 34 Z" fill={t.color} opacity=".25" />
          <path
            d="M2 34 C 14 33 20 20 28 10 C 34 3 38 2 42 4 C 50 9 54 26 62 34"
            fill="none"
            stroke={t.color}
            strokeWidth="1.6"
          />
        </svg>
      );
    case "bars":
      return (
        <svg width="60" height="32" viewBox="0 0 60 32">
          {[14, 20, 8, 26, 30, 18, 12].map((h, i) => (
            <rect
              key={i}
              x={2 + i * 8.3}
              y={32 - h}
              width="6"
              height={h}
              rx="2"
              fill={t.color}
              opacity={i === 6 ? 0.4 : 1}
            />
          ))}
        </svg>
      );
    case "ring":
      return (
        <svg width="40" height="40" viewBox="0 0 40 40" className="-rotate-90">
          <circle cx="20" cy="20" r="15" fill="none" stroke="var(--color-track)" strokeWidth="5" />
          <circle
            cx="20"
            cy="20"
            r="15"
            fill="none"
            stroke={t.color}
            strokeWidth="5"
            strokeDasharray="70 95"
            strokeLinecap="round"
          />
        </svg>
      );
    case "list":
      return (
        <span className="flex w-14 flex-col gap-1.5">
          {[90, 55, 25].map((w, i) => (
            <span
              key={w}
              className="h-[5px] rounded-full"
              style={{ width: `${w}%`, background: t.color, opacity: 1 - i * 0.25 }}
            />
          ))}
        </span>
      );
    case "split":
      return (
        <span className="flex w-14 flex-col gap-2">
          <span className="flex h-[6px] gap-[2px]">
            <span className="flex-[6] rounded-full" style={{ background: COLOR.solar }} />
            <span className="flex-[3] rounded-full" style={{ background: COLOR.battery }} />
            <span className="flex-[1] rounded-full" style={{ background: COLOR.bar }} />
          </span>
          <span className="h-[4px] w-3/4 rounded-full bg-fg/15" />
          <span className="h-[4px] w-1/2 rounded-full bg-fg/15" />
        </span>
      );
    case "table":
      return (
        <span className="flex w-14 flex-col gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="flex items-center gap-1">
              <i className="size-1.5 rounded-full" style={{ background: i === 1 ? COLOR.solar : t.color }} />
              <span className="h-[4px] flex-1 rounded-full bg-fg/15" />
              <span className="h-[4px] w-3 rounded-full" style={{ background: t.color, opacity: 0.8 }} />
            </span>
          ))}
        </span>
      );
    case "alert":
      return (
        <span
          className="flex items-center gap-1 px-1 text-[10px] font-medium whitespace-nowrap"
          style={{ color: t.color }}
        >
          <Icon name="shield" size={14} />
          {t.value}
        </span>
      );
    case "tile":
      return (
        <span className="flex items-center gap-2">
          <span
            className="size-6 rounded-lg"
            style={{ background: t.color, boxShadow: `0 4px 10px -4px ${t.color}` }}
          />
          <span className="relative h-3.5 w-6 rounded-full bg-good">
            <i className="absolute top-0.5 right-0.5 size-2.5 rounded-full bg-white" />
          </span>
        </span>
      );
    case "flow":
      return (
        <svg width="60" height="36" viewBox="0 0 60 36">
          <path
            d="M12 8 L26 16 M48 8 L34 16 M12 28 L26 20 M34 20 L48 28"
            stroke="currentColor"
            className="text-fg/35"
            strokeWidth="1.3"
          />
          <circle cx="30" cy="18" r="4.5" fill="none" stroke="var(--color-ink)" strokeWidth="1.4" />
          <circle cx="8" cy="7" r="4.5" fill={COLOR.solar} />
          <circle cx="52" cy="7" r="4.5" fill={COLOR.import} />
          <circle cx="8" cy="29" r="4.5" fill={COLOR.battery} />
          <circle cx="52" cy="29" r="4.5" fill={COLOR.teal} />
        </svg>
      );
    case "scene":
      return (
        <svg width="62" height="40" viewBox="0 0 520 330">
          <polygon points="60,230 260,320 460,230 260,140" fill="#c9d8bf" />
          <polygon points="150,200 150,130 260,180 260,250" fill="#d8c3a0" />
          <polygon points="260,250 260,180 370,130 370,200" fill="#c7ad84" />
          <polygon points="135,137 260,192 260,120 150,72" fill="#3b3f4a" />
          <polygon points="260,192 385,137 370,72 260,120" fill="#4a4f5c" />
          <polygon points="160,120 245,158 245,128 168,93" fill="#27407a" />
          <polygon points="275,158 360,120 352,93 275,128" fill="#2b4888" />
        </svg>
      );
    case "ribbons":
      return (
        <svg width="60" height="36" viewBox="0 0 60 36">
          <path d="M6 4 C 30 4 30 2 54 2 L 54 8 C 30 8 30 10 6 10 Z" fill="var(--color-ink)" opacity=".35" />
          <path d="M6 10 C 30 10 30 14 54 14 L 54 34 C 30 34 30 32 6 32 Z" fill={COLOR.export} opacity=".45" />
          <rect x="2" y="4" width="4" height="28" rx="1.5" fill={COLOR.solar} />
          <rect x="54" y="2" width="4" height="6" rx="1.5" fill="var(--color-ink)" />
          <rect x="54" y="14" width="4" height="20" rx="1.5" fill={COLOR.export} />
        </svg>
      );
    case "donut":
      return (
        <svg width="40" height="40" viewBox="0 0 40 40" className="-rotate-90">
          <circle cx="20" cy="20" r="15" fill="none" stroke="var(--color-track)" strokeWidth="6" />
          <circle cx="20" cy="20" r="15" fill="none" stroke={COLOR.solar} strokeWidth="6" strokeDasharray="55 95" />
          <circle
            cx="20"
            cy="20"
            r="15"
            fill="none"
            stroke={COLOR.battery}
            strokeWidth="6"
            strokeDasharray="22 95"
            strokeDashoffset="-56"
          />
          <circle
            cx="20"
            cy="20"
            r="15"
            fill="none"
            stroke={COLOR.import}
            strokeWidth="6"
            strokeDasharray="14 95"
            strokeDashoffset="-79"
          />
        </svg>
      );
    case "rows":
      return (
        <span className="flex w-14 flex-col gap-[5px]">
          {[
            [86, COLOR.solar],
            [20, "var(--color-ink)"],
            [70, COLOR.export],
            [55, COLOR.battery],
          ].map(([w, c], i) => (
            <span key={i} className="h-[4px] rounded-full bg-track">
              <span className="block h-full rounded-full" style={{ width: `${w}%`, background: c as string }} />
            </span>
          ))}
        </span>
      );
    case "tiles":
      return (
        <span className="grid w-14 grid-cols-2 gap-1">
          {[COLOR.solar, "var(--color-ink)", COLOR.export, COLOR.battery].map((c, i) => (
            <span key={i} className="flex h-4 items-end rounded-[4px] bg-fg/8 px-1 pb-0.5">
              <span className="h-[3px] w-full rounded-full" style={{ background: c }} />
            </span>
          ))}
        </span>
      );
  }
}
