import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { errorMessage } from "~/features/common/api/utils";
import { ON } from "~/features/common/energy/utils";
import { kW, pct } from "~/features/common/formatting/utils/number";
import type { Snapshot } from "~/features/common/live/types";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { useMedia } from "~/features/common/layout/hooks";
import { LocationPrompt } from "~/features/common/settings/components/LocationPrompt";
import { useLocationSet } from "~/features/common/settings/hooks";
import { STORE_DASHBOARD, store } from "~/features/common/storage/utils";
import { greeting } from "~/features/common/time/utils";
import { BottomSheet } from "~/features/common/ui/components/BottomSheet";
import { Button } from "~/features/common/ui/components/Button";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { cn } from "~/features/common/ui/utils";
import { dashboardsQuery, saveDashboards } from "~/features/dashboards/api";
import { DashboardGrid } from "~/features/dashboards/components/DashboardGrid";
import { AddWidgets, WidgetSettings } from "~/features/dashboards/components/Panels";
import { useWidgetCtx } from "~/features/dashboards/hooks";
import type { Dashboard, Screen, WidgetItem } from "~/features/dashboards/types";
import { COLS, compact, firstFit, forPhone, newId, resize } from "~/features/dashboards/utils/layout";
import { defaultDashboards, preset, presetLayout, PRESETS } from "~/features/dashboards/utils/presets";
import { defaultSettings, sizesOf, widgetDef } from "~/features/dashboards/widgets/registry";
import type { Settings } from "~/features/common/widgets/types";

/** A dashboard's widgets for a screen: a phone's own, or (until it has its own) the computer's in reading order. */
function layoutFor(board: Dashboard, screen: Screen): WidgetItem[] {
  if (screen === "computer") return board.layouts.computer;
  return (
    board.layouts.phone ??
    forPhone(board.layouts.computer, (item) => {
      const def = widgetDef(item.type);
      return def ? sizesOf(def, item.settings, "phone").default : [4, item.h];
    })
  );
}

/**
 * What the house is running on now, in a few words, for under the page's title: what it's using and where most of that
 * comes from, then where spare power's going ("Using 2.2 kW · 96% from the battery", "Using 640 W · all from solar ·
 * selling 3.1 kW").
 */
function doing(p: Snapshot | null): string {
  if (!p || p.load_power == null) return "How your home's running right now";
  const home = Math.max(0, p.load_power);
  const g = p.grid_power ?? 0;
  const b = p.battery_power ?? 0;
  const from: [string, number][] = [
    ["solar", Math.min(Math.max(0, p.pv_power ?? 0), home)],
    ["the battery", Math.max(0, b)],
    ["the grid", Math.max(0, g)],
  ];
  const total = from.reduce((a, [, w]) => a + w, 0);
  const [name, most] = from.reduce((a, x) => (x[1] > a[1] ? x : a));
  const share = total > 0 ? most / total : 0;
  const source =
    home < ON || total <= 0
      ? null
      : share >= 0.99
        ? `all from ${name}`
        : share >= 0.5
          ? `${pct(share * 100)} from ${name}`
          : `from ${from
              .filter(([, w]) => w >= ON)
              .map(([n]) => n)
              .join(", ")
              .replace(/, ([^,]*)$/, " and $1")}`;
  const spare = g < -ON && -g >= -b ? `selling ${kW(-g)}` : b < -ON ? `charging the battery at ${kW(-b)}` : null;
  return [home < ON ? "Hardly using anything right now" : `Using ${kW(home)}`, source, spare]
    .filter(Boolean)
    .join(" · ");
}

type Draft = {
  boards: Dashboard[];
  id: string;
  screen: Screen;
  selected: string | null;
  /** Earlier states, for Undo. */
  past: Dashboard[][];
  /** On a phone: which sheet is open. */
  sheet: "add" | "settings" | null;
  /** Asking to delete the dashboard. */
  deleting: boolean;
  /** How wide the dashboard was shown (px), for it to be arranged at just that size. */
  width: number;
  /** On a computer: the tray is open (it can be tucked away, to see the whole dashboard). */
  tray: boolean;
};

/**
 * The Overview: dashboards of widgets, each laid out for a computer and a phone. Customise arranges the one shown:
 * drag and resize widgets, add them from the list, set each one up, start from a ready-made layout, add, rename or
 * delete dashboards; Done saves it all for every browser in the house.
 */
export function DashboardPage() {
  const ctx = useWidgetCtx();
  const located = useLocationSet();
  const qc = useQueryClient();
  const phone = useMedia("(max-width: 639px)");
  const { data: doc } = useQuery(dashboardsQuery);
  const boards = doc?.dashboards ?? defaultDashboards(ctx);
  const [current, setCurrent] = useState(() => store.get(STORE_DASHBOARD));
  const [draft, setDraft] = useState<Draft | null>(null);
  const shown = useRef<HTMLDivElement>(null);
  // Arranging on a computer, the page is the dashboard and the tray: the side nav steps aside (see AppShell), so the
  // dashboard keeps the width it's shown at.
  const arranging = !!draft && !phone;
  const tray = arranging && draft.tray;
  useEffect(() => {
    if (!arranging) return;
    document.documentElement.dataset.customising = tray ? "tray" : "";
    return () => {
      delete document.documentElement.dataset.customising;
    };
  }, [arranging, tray]);
  const save = useMutation({
    mutationFn: saveDashboards,
    onSuccess: (d) => {
      qc.setQueryData(dashboardsQuery.queryKey, d);
      setDraft(null);
    },
  });

  const all = draft?.boards ?? boards;
  const board = all.find((b) => b.id === (draft?.id ?? current)) ?? all[0];
  // On a phone only the phone's layout is arranged: the computer's is for a screen this one can't show.
  const screen: Screen = phone ? "phone" : (draft?.screen ?? "computer");
  const items = layoutFor(board, screen);
  const cols = COLS[screen];

  const pick = (id: string) => {
    setCurrent(id);
    store.set(STORE_DASHBOARD, id);
  };
  const begin = (boardsNow: Dashboard[], id: string) =>
    setDraft({
      boards: boardsNow,
      id,
      screen: phone ? "phone" : "computer",
      selected: null,
      past: [],
      sheet: null,
      deleting: false,
      width: shown.current?.clientWidth ?? 0,
      tray: true,
    });
  /** A change to the draft, kept for Undo. */
  const change = (next: (d: Draft) => Partial<Draft>) =>
    setDraft((d) => (d ? { ...d, ...next(d), past: [...d.past.slice(-40), d.boards] } : d));
  const setItems = (next: WidgetItem[]) =>
    change((d) => ({
      boards: d.boards.map((b) => (b.id === board.id ? { ...b, layouts: { ...b.layouts, [screen]: next } } : b)),
    }));

  const add = (type: string) => {
    const def = widgetDef(type);
    if (!def) return;
    const settings = defaultSettings(def, ctx);
    const [dw, h] = sizesOf(def, settings, screen).default;
    const w = Math.min(dw, cols);
    const item: WidgetItem = { id: newId(), type, ...firstFit(items, w, h, cols), w, h, settings };
    setItems([...items, item]);
    setDraft((d) => d && { ...d, selected: item.id, sheet: null });
    requestAnimationFrame(() =>
      document.querySelector(`[data-widget="${item.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
  };
  const remove = (id: string) => {
    setItems(compact(items.filter((i) => i.id !== id)));
    setDraft((d) => d && { ...d, selected: d.selected === id ? null : d.selected });
  };
  const configure = (id: string, c: { settings?: Settings; w?: number; h?: number }) => {
    const item = items.find((i) => i.id === id);
    const def = item && widgetDef(item.type);
    if (!item || !def) return;
    const settings = c.settings ?? item.settings;
    const next = items.map((i) => (i.id === id ? { ...i, settings } : i));
    const w = c.w ?? item.w;
    setItems(resize(next, id, w, c.h ?? item.h, cols, sizesOf(def, settings, screen, w)));
  };
  const newBoard = () => {
    const b: Dashboard = {
      id: newId(),
      name: `Dashboard ${boards.length + 1}`,
      layouts: { computer: presetLayout(preset("glance"), ctx), phone: null },
    };
    begin([...boards, b], b.id);
  };

  const selected = draft?.selected ? items.find((i) => i.id === draft.selected) : undefined;
  const panel = (bare = false) =>
    selected ? (
      <WidgetSettings
        bare={bare}
        key={selected.id}
        item={selected}
        ctx={ctx}
        screen={screen}
        onChange={(c) => configure(selected.id, c)}
        onRemove={() => remove(selected.id)}
        onDone={() => setDraft((d) => d && { ...d, selected: null })}
      />
    ) : (
      <AddWidgets ctx={ctx} onAdd={add} placed={new Set(items.map((i) => i.type))} bare={bare} />
    );

  if (!draft)
    return (
      <>
        <PageHeader
          title={greeting(ctx.now)}
          sub={doing(ctx.p)}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="tablist"
                aria-label="Your dashboards"
                className="flex max-w-full gap-0.5 overflow-x-auto rounded-full border border-line-subtle bg-surface p-1"
              >
                {boards.map((b) => (
                  <button
                    key={b.id}
                    role="tab"
                    type="button"
                    aria-selected={b.id === board.id}
                    onClick={() => pick(b.id)}
                    className={cn(
                      "h-8 cursor-pointer rounded-full border-0 px-4 font-sans text-[13px] font-medium whitespace-nowrap transition-colors",
                      b.id === board.id ? "bg-ink text-ink-inverse" : "bg-transparent text-ink-sub hover:text-ink",
                    )}
                  >
                    {b.name}
                  </button>
                ))}
                <button
                  type="button"
                  aria-label="Add a dashboard"
                  title="Add a dashboard"
                  onClick={newBoard}
                  className="flex size-8 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-ink-sub hover:text-ink"
                >
                  <Icon name="plus" size={15} />
                </button>
              </div>
              <Button variant="outline" size="sm" onClick={() => begin(boards, board.id)}>
                <Icon name="pencil" size={14} />
                Customise
              </Button>
            </div>
          }
        />
        {located === false && (
          <LocationPrompt className="mb-5">
            The solar forecast, the weather, and outages and warnings near you all need your location.
          </LocationPrompt>
        )}
        <div ref={shown}>
          <DashboardGrid key={`${board.id}:${screen}`} items={items} ctx={ctx} screen={screen} />
        </div>
        {!items.length && (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-ink-muted">
            <span>Nothing on this dashboard yet.</span>
            <Button variant="primary" size="sm" onClick={() => begin(boards, board.id)}>
              Add widgets
            </Button>
          </div>
        )}
      </>
    );

  const others = draft.boards.filter((b) => b.id !== board.id);
  return (
    <>
      {/* On a computer the tray of widgets (or the one chosen's settings) is down the right edge, full height. */}
      <div>
        <div className="flex flex-col gap-4 pt-2 pb-6">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="flex items-baseline gap-2 font-display text-[26px] leading-9 font-bold">
              Customising
              <input
                value={board.name}
                aria-label="Dashboard name"
                maxLength={40}
                size={Math.max(4, board.name.length)}
                onChange={(e) => {
                  const name = e.target.value;
                  setDraft((d) => d && { ...d, boards: d.boards.map((b) => (b.id === board.id ? { ...b, name } : b)) });
                }}
                className="min-w-0 rounded-lg border border-transparent bg-transparent px-1 font-display text-[26px] leading-9 font-bold text-brand outline-none hover:border-line focus:border-line-strong"
              />
            </span>
            <span className="text-[13px] text-ink-sub">
              Drag a widget to move it, pull its corner to resize it, or add more from the{" "}
              {phone ? "button below. This is your phone's layout; your computer's stays as it is" : "right"}.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!phone && (
              <Segmented
                label="Layout for"
                options={[
                  { value: "computer", label: "Computer" },
                  { value: "phone", label: "Phone" },
                ]}
                value={screen}
                onChange={(sc) => setDraft((d) => d && { ...d, screen: sc, selected: null })}
              />
            )}
            <label className="relative flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-transparent px-3.5 text-[13px] font-medium text-ink hover:border-line-strong">
              Start from a layout
              <Icon name="chevD" size={13} />
              <select
                value=""
                aria-label="Start from a layout"
                onChange={(e) => {
                  const chosen = PRESETS.find((p) => p.id === e.target.value);
                  if (!chosen) return;
                  const laid = presetLayout(chosen, ctx);
                  change((d) => ({
                    boards: d.boards.map((b) =>
                      b.id !== board.id
                        ? b
                        : phone
                          ? // on a phone, the phone's layout from it; the computer's stays as it is
                            {
                              ...b,
                              layouts: {
                                ...b.layouts,
                                phone: layoutFor({ ...b, layouts: { computer: laid, phone: null } }, "phone"),
                              },
                            }
                          : { ...b, layouts: { computer: laid, phone: null } },
                    ),
                    selected: null,
                  }));
                }}
                className="absolute inset-0 cursor-pointer opacity-0"
              >
                <option value="">Start from a layout</option>
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.sub}
                  </option>
                ))}
              </select>
            </label>
            <span className="flex-1" />
            <Button
              variant="muted-link"
              size="sm"
              disabled={!draft.past.length}
              onClick={() =>
                setDraft(
                  (d) => d && { ...d, boards: d.past[d.past.length - 1], past: d.past.slice(0, -1), selected: null },
                )
              }
              className="px-2 disabled:opacity-40"
            >
              Undo
            </Button>
            <Button variant="muted-link" size="sm" onClick={() => setDraft(null)} className="px-2">
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={save.isPending}
              onClick={() => save.mutate(draft.boards, { onSuccess: () => pick(draft.id) })}
            >
              {save.isPending ? "Saving…" : "Done"}
            </Button>
          </div>
        </div>
        {save.isError && <Notice className="mb-4">{errorMessage(save.error)}</Notice>}
        {screen === "phone" && board.layouts.phone && (
          <Notice tone="plain" className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <span>The phone has its own layout. Changes on the computer won't change it.</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                change((d) => ({
                  boards: d.boards.map((b) =>
                    b.id === board.id ? { ...b, layouts: { ...b.layouts, phone: null } } : b,
                  ),
                  selected: null,
                }))
              }
            >
              Follow the computer's again
            </Button>
          </Notice>
        )}

        <div>
          <div
            className={cn(
              "-mx-3 min-w-0 rounded-[28px] bg-[radial-gradient(var(--color-line)_1px,transparent_1px)] bg-[length:22px_22px] px-3 pt-5 pb-16",
              screen === "phone" && !phone && "flex justify-center",
              screen === "computer" && !phone && "w-fit min-w-[calc(100%+24px)]",
            )}
          >
            {/* At the width it's shown at, so each widget looks just as it will; where the tray leaves less room, the
                dashboard runs under it. */}
            <div
              data-widgets
              style={screen === "computer" && !phone && draft.width ? { width: draft.width } : undefined}
              className={cn(
                screen === "phone" && !phone && "w-[402px] rounded-[32px] border border-line bg-canvas p-4",
              )}
            >
              <DashboardGrid
                key={`${board.id}:${screen}`}
                items={items}
                ctx={ctx}
                screen={screen}
                editing
                selected={draft.selected}
                onSelect={(id) => setDraft((d) => d && { ...d, selected: id })}
                onSettings={(id) => setDraft((d) => d && { ...d, selected: id, sheet: "settings", tray: true })}
                onChange={setItems}
                onRemove={remove}
              />
              {!items.length && (
                <div className="py-16 text-center text-ink-muted">Add a widget from the list to start.</div>
              )}
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-line-subtle pt-5 text-[13px] text-ink-muted">
              {draft.deleting ? (
                <>
                  <span>Delete {board.name} and its widgets?</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setDraft(
                        (d) =>
                          d && {
                            ...d,
                            boards: others,
                            id: others[0].id,
                            past: [...d.past, d.boards],
                            deleting: false,
                            selected: null,
                          },
                      )
                    }
                  >
                    Delete it
                  </Button>
                  <Button
                    variant="muted-link"
                    size="sm"
                    onClick={() => setDraft((d) => d && { ...d, deleting: false })}
                  >
                    Keep it
                  </Button>
                </>
              ) : (
                others.length > 0 && (
                  <Button
                    variant="muted-link"
                    size="sm"
                    onClick={() => setDraft((d) => d && { ...d, deleting: true })}
                    className="text-bad hover:text-bad"
                  >
                    Delete this dashboard
                  </Button>
                )
              )}
            </div>
          </div>
        </div>
        {/* In the body, not the page: the page's sections rise in on a transform, which would hold a fixed tray
            inside the page's padding until it ends. */}
        {!phone &&
          createPortal(
            draft.tray ? (
              <aside
                aria-label={selected ? "Widget settings" : "Add widgets"}
                className="fixed inset-y-0 right-0 z-40 flex w-[380px] animate-[wmpTrayIn_320ms_var(--ease-out-soft)] flex-col gap-4 overflow-y-auto border-l border-line-subtle bg-surface-inset px-6 py-7 shadow-[-24px_0_60px_-30px_rgb(0_0_0/0.6)] light:bg-surface"
              >
                <button
                  type="button"
                  aria-label="Tuck the tray away"
                  title="Tuck the tray away, to see the whole dashboard"
                  onClick={() => setDraft((d) => d && { ...d, tray: false })}
                  className="absolute top-6 right-5 flex size-8 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-ink-sub hover:bg-fg/8 hover:text-ink"
                >
                  <Icon name="chevR" size={16} />
                </button>
                {selected && (
                  <button
                    type="button"
                    onClick={() => setDraft((d) => d && { ...d, selected: null })}
                    className="flex cursor-pointer items-center gap-1 self-start border-0 bg-transparent p-0 font-sans text-[13px] text-brand hover:underline"
                  >
                    <Icon name="chevL" size={14} />
                    All widgets
                  </button>
                )}
                {panel()}
              </aside>
            ) : (
              <button
                type="button"
                onClick={() => setDraft((d) => d && { ...d, tray: true })}
                className="fixed right-6 bottom-6 z-40 flex h-11 animate-[wmpTrayIn_320ms_var(--ease-out-soft)] cursor-pointer items-center gap-2 rounded-full border-0 bg-ink px-5 font-sans text-sm font-semibold text-ink-inverse shadow-pop"
              >
                <Icon name="plus" size={16} />
                {selected ? "Widget settings" : "Add widgets"}
              </button>
            ),
            document.body,
          )}
      </div>

      {phone && (
        <>
          <button
            type="button"
            onClick={() => setDraft((d) => d && { ...d, selected: null, sheet: "add" })}
            className="fixed right-4 bottom-24 z-30 flex h-12 cursor-pointer items-center gap-2 rounded-full border-0 bg-ink px-5 font-sans text-sm font-semibold text-ink-inverse shadow-pop"
          >
            <Icon name="plus" size={16} />
            Add a widget
          </button>
          <BottomSheet
            open={draft.sheet != null}
            title={selected ? (widgetDef(selected.type)?.name ?? "Widget") : "Add a widget"}
            onClose={() => setDraft((d) => d && { ...d, sheet: null })}
          >
            {draft.sheet && panel(true)}
          </BottomSheet>
        </>
      )}
    </>
  );
}
