import { useCallback, useRef, useState, type ReactNode } from "react";
import { reducedMotion } from "~/features/common/display/utils";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { BottomSheet } from "~/features/common/ui/components/BottomSheet";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import {
  CarSpaces,
  GardenRows,
  HousePreview,
  KindTiles,
  PanelsRow,
  RoofSwatches,
  SaveNote,
  StoreyTiles,
  summaries,
  UnitRows,
  unitsSub,
  unitsTitle,
  WallSwatches,
  type HouseEditor,
} from "~/features/settings/components/HouseFields";
import { OptionList } from "~/features/settings/components/SettingsSection";
import { partSpots, type HousePart } from "~/features/settings/utils/houseSpots";

/** The phone's picture: a little taller than the wide one, cropping the empty sky at the sides. */
const ASPECT = 4 / 3;

/** Where the house's top goes while a part's sheet is open: just under the phone's header. */
const UNDER_HEADER = 76;

/** Each part: its name, what its dot says to a screen reader, its icon and colour, and its choices. */
const PARTS: Record<HousePart, { title: string; dot: string; icon: IconName; color: string }> = {
  kind: { title: "Kind of house", dot: "Kind of house and storeys", icon: "home", color: COLOR.brand },
  roof: { title: "Roof", dot: "Roof: its colour and the solar panels", icon: "sun", color: COLOR.solar },
  walls: { title: "Walls", dot: "Walls: their finish", icon: "layout", color: COLOR.lilac },
  cars: { title: "Garage or carport", dot: "Garage or carport: the car spaces", icon: "car", color: COLOR.good },
  garden: { title: "Garden", dot: "Garden: the pool, the fence and the trees", icon: "droplet", color: COLOR.teal },
  units: { title: "Inverters", dot: "Inverters and battery: where they hang", icon: "bolt", color: COLOR.battery },
};

const ORDER: HousePart[] = ["kind", "roof", "walls", "cars", "garden", "units"];

/** A part's choices, for its sheet: with a line under its title. */
function partSheet(e: HouseEditor, part: HousePart): { title: string; sub: string; body: ReactNode } {
  switch (part) {
    case "kind":
      return {
        title: "Kind of house",
        sub: "Its shape: walls, roof, windows and porch, on one level or two.",
        body: (
          <>
            <StoreyTiles e={e} />
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold">Kind of house</span>
              <KindTiles e={e} />
            </div>
          </>
        ),
      };
    case "roof":
      return {
        title: "Roof",
        sub: "Its colour, and the panels on it. A is the kind of house's own.",
        body: (
          <>
            <RoofSwatches e={e} />
            <OptionList>
              <PanelsRow e={e} />
            </OptionList>
          </>
        ),
      };
    case "walls":
      return { title: "Walls", sub: "Their finish. A is the kind of house's own.", body: <WallSwatches e={e} /> };
    case "cars":
      return {
        title: "Garage or carport",
        sub: "How many cars it takes, beside the house.",
        body: <CarSpaces e={e} />,
      };
    case "garden":
      return {
        title: "Garden",
        sub: "A pool, the fence along the street, and the trees.",
        body: (
          <OptionList>
            <GardenRows e={e} />
          </OptionList>
        ),
      };
    case "units":
      return { title: unitsTitle(e), sub: unitsSub(e), body: <UnitRows e={e} /> };
  }
}

/**
 * Settings → Your house on a phone: the house large at the top with a dot on each part you can change (the roof, the
 * walls, the garage or carport, the garden, the inverters), its kind in a pill over it, and the same parts listed
 * under it. Tapping one opens its choices in a sheet over the lower half, and the house above changes as they do.
 */
export function HousePhone({ e }: { e: HouseEditor }) {
  const [part, setPart] = useState<HousePart | null>(null);
  // The last part opened, so its sheet keeps its choices while it slides away.
  const [shown, setShown] = useState<HousePart>("kind");
  const preview = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setPart(null), []);
  const open = (p: HousePart) => {
    // The house glides up to just under the header, clear of the sheet, so each change shows.
    const r = preview.current?.getBoundingClientRect();
    if (r && (r.top < UNDER_HEADER - 4 || r.bottom > window.innerHeight * 0.44))
      window.scrollTo({ top: window.scrollY + r.top - UNDER_HEADER, behavior: reducedMotion() ? "auto" : "smooth" });
    setShown(p);
    setPart(p);
  };
  const said = summaries(e);
  const sheet = partSheet(e, shown);
  const spots = partSpots(e.house, ASPECT);

  return (
    <div className="flex flex-col gap-4">
      <div ref={preview}>
        <HousePreview e={e} className="aspect-[4/3]">
          <button
            type="button"
            onClick={() => open("kind")}
            aria-label={`${PARTS.kind.dot}: ${said.kind}`}
            className={cn(
              "absolute top-3 left-3 flex max-w-[calc(100%-24px)] items-center gap-1.5 rounded-full bg-white/85 py-1.5 pr-2.5 pl-3 text-[13px] font-semibold text-[#111] shadow-[0_4px_14px_-6px_rgb(0_0_0/0.35)] backdrop-blur-md transition-[transform,opacity] active:scale-95",
              part && part !== "kind" && "opacity-50",
            )}
          >
            <Icon name="home" size={14} className="flex-none" />
            <span className="truncate">{said.kind}</span>
            <Icon name="chevR" size={14} className="flex-none opacity-50" />
          </button>
          {spots.map((s, i) => (
            <Hotspot
              key={s.part}
              label={PARTS[s.part].dot}
              x={s.x}
              y={s.y}
              delay={i * 0.35}
              on={part === s.part}
              dim={!!part && part !== s.part}
              onClick={() => open(s.part)}
            />
          ))}
        </HousePreview>
      </div>
      <SaveNote e={e} hint="Tap a dot on the house to change that part, or choose below." className="-mt-1" />

      <section
        aria-label="Parts of the house"
        className="glass flex flex-col overflow-hidden rounded-[20px] border border-line-subtle"
      >
        {ORDER.map((p) => {
          const meta = PARTS[p];
          return (
            <button
              key={p}
              type="button"
              onClick={() => open(p)}
              className="group flex min-h-[60px] items-center gap-3.5 border-b border-line-subtle px-4 py-2.5 text-left text-ink transition-colors duration-150 last:border-b-0 hover:bg-surface-inset"
            >
              <span
                aria-hidden
                className="flex size-9 flex-none items-center justify-center rounded-[10px]"
                style={{ background: alpha(meta.color, 0.16), color: meta.color }}
              >
                <Icon name={meta.icon} size={19} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px] font-semibold">{p === "units" ? unitsTitle(e) : meta.title}</span>
                <span className="truncate text-[13px] text-ink-muted">{said[p]}</span>
              </span>
              <Icon name="chevR" size={18} className="flex-none text-ink-faint" />
            </button>
          );
        })}
      </section>

      <BottomSheet open={!!part} title={sheet.title} sub={sheet.sub} onClose={close}>
        {sheet.body}
      </BottomSheet>
    </div>
  );
}

/**
 * A part's dot on the drawing: white with a dark ring and a soft pulse around it (still, where motion's reduced),
 * filled in the brand colour while its sheet is open. The button around it is a full finger's width.
 */
function Hotspot({
  label,
  x,
  y,
  delay,
  on,
  dim,
  onClick,
}: {
  label: string;
  x: number;
  y: number;
  delay: number;
  on: boolean;
  dim: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={on}
      onClick={onClick}
      className={cn(
        "absolute flex size-11 -translate-1/2 items-center justify-center rounded-full transition-opacity duration-200",
        dim && "opacity-40",
      )}
      style={{ left: `${(x * 100).toFixed(2)}%`, top: `${(y * 100).toFixed(2)}%` }}
    >
      {!on && (
        <span
          aria-hidden
          className="absolute size-5 animate-[hotspotPulse_2.6s_var(--ease-out-soft)_infinite] rounded-full bg-white/80"
          style={{ animationDelay: `${delay}s` }}
        />
      )}
      <span
        aria-hidden
        className={cn(
          "relative rounded-full border-white shadow-[0_2px_8px_rgb(0_0_0/0.35)] transition-[width,height,background-color] duration-200",
          on ? "size-5 border-[3px] bg-brand" : "size-4 border-[3px] bg-[#111]/80",
        )}
      />
    </button>
  );
}
