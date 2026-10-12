import {
  Component,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import type { Screen, WidgetItem } from "~/features/dashboards/types";
import { COLS, GAP, move, resize, ROW } from "~/features/dashboards/utils/layout";
import { Quiet, WidgetCard } from "~/features/common/widgets/parts";
import { sizesOf, widgetDef } from "~/features/dashboards/widgets/registry";
import type { WidgetCtx } from "~/features/common/widgets/types";

/** A widget that fails to draw shows that it couldn't, and the rest of the page carries on. */
class Guard extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <WidgetCard title={this.props.name}>
        <Quiet>This widget couldn't be shown. Reload the page, or remove it and add it again.</Quiet>
      </WidgetCard>
    ) : (
      this.props.children
    );
  }
}

/** One widget as it's drawn: its own content, or why it can't be shown here yet. */
function Body({ item, ctx, screen }: { item: WidgetItem; ctx: WidgetCtx; screen: Screen }) {
  const def = widgetDef(item.type);
  if (!def)
    return (
      <WidgetCard title="Widget">
        <Quiet>This widget isn't in this version. Remove it, or update.</Quiet>
      </WidgetCard>
    );
  const missing = def.needs?.(ctx);
  if (missing)
    return (
      <WidgetCard title={def.name} icon={def.icon}>
        <Quiet>{missing}.</Quiet>
      </WidgetCard>
    );
  return (
    <Guard name={def.name}>
      <def.Component ctx={ctx} settings={item.settings} w={item.w} h={item.h} screen={screen} />
    </Guard>
  );
}

type Drag = {
  id: string;
  mode: "move" | "resize";
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  /** The rows' heights as they were when it started (they grow to fit what's in them), to count rows moved by. */
  rows: number[];
  /** Where the widget was in the grid, and its size, as drawn. */
  box: { left: number; top: number; width: number; height: number };
};

/**
 * How many rows a pull of `d` pixels from the line between rows `line - 1` and `line` crosses, by the rows' own heights:
 * a row counts once the pull is past half of it.
 */
function rowsBy(rows: number[], line: number, d: number) {
  let left = Math.abs(d);
  let n = 0;
  for (let r = d > 0 ? line : line - 1; r >= 0; r += d > 0 ? 1 : -1) {
    const step = (rows[r] ?? ROW) + GAP;
    if (left < step / 2) break;
    left -= step;
    n++;
  }
  return d > 0 ? n : -n;
}

const place = (i: WidgetItem): CSSProperties => ({
  gridColumn: `${i.x + 1} / span ${i.w}`,
  gridRow: `${i.y + 1} / span ${i.h}`,
});

/**
 * A dashboard's widgets on its grid (12 columns on a computer, 4 on a phone). A row is at least its height and grows to
 * fit what's in it, so nothing is cut off, and being arranged a widget looks just as it does shown. Each can be dragged
 * by its body (on a touch screen, by the bar on top), resized by its corner, or moved and resized with the arrow keys
 * (Shift for size); the rest make room as it goes.
 */
export function DashboardGrid({
  items,
  ctx,
  screen,
  editing = false,
  selected,
  onSelect,
  onSettings = onSelect,
  onChange,
  onRemove,
}: {
  items: WidgetItem[];
  ctx: WidgetCtx;
  screen: Screen;
  editing?: boolean;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  /** Its settings asked for (its button, or Enter); else it's just chosen. */
  onSettings?: (id: string) => void;
  onChange?: (items: WidgetItem[]) => void;
  onRemove?: (id: string) => void;
}) {
  const cols = COLS[screen];
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDragState] = useState<Drag | null>(null);
  // The drag as it is this moment, for the pointer's next move and its letting go, which can come before a redraw.
  const live = useRef<Drag | null>(null);
  // The widgets there were when arranging began, and since: one that's new fades in, the rest just stay put.
  const [known] = useState(() => new Set(items.map((i) => i.id)));
  useEffect(() => {
    for (const i of items) known.add(i.id);
  }, [items, known]);
  const setDrag = (d: Drag | null) => {
    live.current = d;
    setDragState(d);
  };

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const unitX = (width + GAP) / cols;
  const limits = (i: WidgetItem) => {
    const def = widgetDef(i.type);
    return def
      ? sizesOf(def, i.settings, screen)
      : { min: [1, 1] as [number, number], max: [cols, 12] as [number, number] };
  };

  /** Where everything would be if the drag ended here. */
  const layoutFor = (d: Drag | null) => {
    const it = d && items.find((i) => i.id === d.id);
    if (!d || !it || unitX <= 0) return items;
    return d.mode === "move"
      ? move(items, d.id, it.x + Math.round(d.dx / unitX), it.y + rowsBy(d.rows, it.y, d.dy), cols)
      : resize(
          items,
          d.id,
          it.w + Math.round(d.dx / unitX),
          it.h + rowsBy(d.rows, it.y + it.h, d.dy),
          cols,
          limits(it),
        );
  };
  const dragged = drag && items.find((i) => i.id === drag.id);
  const shown = layoutFor(drag);

  if (!editing)
    return (
      <div
        ref={box}
        className="grid gap-5"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: `minmax(${ROW}px, auto)` }}
      >
        {items.map((i) => (
          <div key={i.id} style={place(i)} className="flex min-w-0 flex-col *:min-h-0 *:flex-1">
            <Body item={i} ctx={ctx} screen={screen} />
          </div>
        ))}
      </div>
    );

  const start = (e: PointerEvent<HTMLElement>, id: string, mode: "move" | "resize") => {
    if (e.button !== 0) return;
    // On a touch screen the page scrolls by a widget's body; it's moved by the bar on top.
    if (mode === "move" && e.pointerType === "touch" && !(e.target as HTMLElement).closest("[data-grip]")) return;
    if ((e.target as HTMLElement).closest("button:not([data-grip])")) return;
    e.preventDefault();
    e.stopPropagation(); // a resize from the corner isn't also a move of the widget it's on
    e.currentTarget.setPointerCapture(e.pointerId);
    onSelect?.(id);
    const grid = box.current;
    const cell = e.currentTarget.closest("[data-widget]");
    if (!grid || !cell) return;
    const g = grid.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    setDrag({
      id,
      mode,
      x0: e.clientX,
      y0: e.clientY,
      dx: 0,
      dy: 0,
      rows: getComputedStyle(grid).gridTemplateRows.split(" ").map(parseFloat),
      box: { left: c.left - g.left, top: c.top - g.top, width: c.width, height: c.height },
    });
  };
  const follow = (e: PointerEvent<HTMLElement>) => {
    const d = live.current;
    if (d) setDrag({ ...d, dx: e.clientX - d.x0, dy: e.clientY - d.y0 });
  };
  const end = (e: PointerEvent<HTMLElement>) => {
    const d = live.current;
    if (!d) return;
    const last = { ...d, dx: e.clientX - d.x0, dy: e.clientY - d.y0 };
    if (Math.abs(last.dx) > 3 || Math.abs(last.dy) > 3) onChange?.(layoutFor(last));
    setDrag(null);
  };
  const key = (e: KeyboardEvent<HTMLElement>, i: WidgetItem) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (d) {
      e.preventDefault();
      onChange?.(
        e.shiftKey
          ? resize(items, i.id, i.w + d[0], i.h + d[1], cols, limits(i))
          : move(items, i.id, i.x + d[0], i.y + d[1], cols),
      );
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onRemove?.(i.id);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSettings?.(i.id);
    }
  };

  return (
    // data-arranging: the widgets' own entrances (rising, fading, filling) keep still here (app.css), as they'd replay
    // each time one's moved or set up.
    <div
      ref={box}
      data-arranging
      className="relative grid gap-5"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: `minmax(${ROW}px, auto)` }}
      onPointerDown={(e) => e.target === e.currentTarget && onSelect?.(null)}
    >
      {shown.map((i) => {
        const def = widgetDef(i.type);
        const moving = drag?.id === i.id && drag.mode === "move";
        const on = selected === i.id;
        return (
          <div
            key={i.id}
            data-widget={i.id}
            style={place(i)}
            className={cn(
              "relative flex min-w-0 flex-col *:flex-1",
              !known.has(i.id) && "animate-[wmpFade_280ms_ease_backwards]",
            )}
          >
            {/* Kept while it's dragged (it holds the pointer), showing where it'll land. */}
            <Frame
              item={i}
              name={def?.name ?? "Widget"}
              on={on}
              ghost={moving}
              onDown={(e) => start(e, i.id, "move")}
              onResize={(e) => start(e, i.id, "resize")}
              onMove={follow}
              onUp={end}
              onKey={(e) => key(e, i)}
              onSettings={() => onSettings?.(i.id)}
              onRemove={() => onRemove?.(i.id)}
            >
              <Body item={i} ctx={ctx} screen={screen} />
            </Frame>
          </div>
        );
      })}
      {/* The widget being dragged, following the pointer, over the rest. */}
      {drag?.mode === "move" && dragged && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-20 overflow-hidden rounded-3xl shadow-[0_28px_60px_-16px_rgb(0_0_0/0.7)] ring-2 ring-brand"
          style={{
            left: drag.box.left + drag.dx,
            top: drag.box.top + drag.dy,
            width: drag.box.width,
            height: drag.box.height,
            transform: "rotate(-1.2deg) scale(1.01)",
          }}
        >
          <div className="flex h-full flex-col *:min-h-0 *:flex-1">
            <Body item={dragged} ctx={ctx} screen={screen} />
          </div>
        </div>
      )}
    </div>
  );
}

/** A widget being arranged: its content, quiet and still, under handles to move, resize, set up and remove it. */
function Frame({
  item,
  name,
  on,
  ghost,
  onDown,
  onResize,
  onMove,
  onUp,
  onKey,
  onSettings,
  onRemove,
  children,
}: {
  item: WidgetItem;
  name: string;
  on: boolean;
  /** It's being dragged: in its place, only where it'll land (its content kept, unseen, holding its room). */
  ghost: boolean;
  onDown: (e: PointerEvent<HTMLElement>) => void;
  onResize: (e: PointerEvent<HTMLElement>) => void;
  onMove: (e: PointerEvent<HTMLElement>) => void;
  onUp: (e: PointerEvent<HTMLElement>) => void;
  onKey: (e: KeyboardEvent<HTMLElement>) => void;
  onSettings: () => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  // On hover they go a shade darker, solid, in either theme (not a light wash), and give a little when pressed.
  const tool =
    "flex size-8 cursor-pointer items-center justify-center rounded-full border border-line bg-surface-raised p-0 text-ink shadow-sm transition-[background-color,border-color,color,scale] duration-150 hover:bg-[color-mix(in_srgb,var(--color-surface-raised),#000_45%)] active:scale-92 light:hover:bg-[color-mix(in_srgb,var(--color-surface-raised),#000_9%)]";
  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={`${name}, ${item.w} by ${item.h}. Drag or use the arrow keys to move it, Shift and the arrow keys to resize it, Delete to remove it.`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onKeyDown={onKey}
      className={cn(
        "group/w relative flex cursor-grab touch-pan-y flex-col rounded-3xl active:cursor-grabbing",
        on
          ? "shadow-[0_0_0_8px_color-mix(in_srgb,var(--color-brand)_14%,transparent)] outline-2 outline-offset-2 outline-brand"
          : "outline-[1.5px] outline-offset-2 outline-brand/40 outline-dashed focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-solid",
      )}
    >
      <div
        inert
        className={cn(
          "pointer-events-none flex flex-1 flex-col rounded-3xl select-none *:min-h-0 *:flex-1",
          ghost && "invisible",
        )}
      >
        {children}
      </div>
      {ghost && <div className="absolute inset-0 rounded-3xl border-2 border-dashed border-brand/60 bg-brand/8" />}
      <span
        data-grip
        aria-hidden
        className="absolute top-0 left-1/2 flex h-6 w-16 -translate-x-1/2 cursor-grab touch-none items-center justify-center"
      >
        <span className="h-1 w-8 rounded-full bg-fg/30" />
      </span>
      <div className="absolute -top-3 right-3 z-10 flex gap-1.5">
        <button
          type="button"
          className={cn(
            tool,
            on &&
              "border-brand bg-brand text-ink-inverse hover:bg-[color-mix(in_srgb,var(--color-brand),#000_18%)] light:hover:bg-[color-mix(in_srgb,var(--color-brand),#000_12%)]",
          )}
          aria-label={`${name} settings`}
          onClick={onSettings}
        >
          <Icon name="settings" size={14} />
        </button>
        <button
          type="button"
          className={cn(tool, "hover:border-bad/50 hover:text-bad")}
          aria-label={`Remove ${name}`}
          onClick={onRemove}
        >
          <Icon name="minus" size={14} />
        </button>
      </div>
      <span className="pointer-events-none absolute -bottom-2.5 left-4 rounded-md border border-brand/40 bg-canvas px-1.5 py-px font-mono text-[10px] text-brand">
        {item.w} × {item.h}
      </span>
      <span
        aria-hidden
        onPointerDown={onResize}
        className="absolute right-1 bottom-1 z-10 flex size-7 cursor-nwse-resize touch-none items-end justify-end p-1.5"
      >
        <span className="size-3 rounded-br-md border-r-2 border-b-2 border-brand" />
      </span>
    </div>
  );
}
