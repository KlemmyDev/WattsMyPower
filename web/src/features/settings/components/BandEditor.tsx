import type { TariffBand, TimeWindow } from "~/features/common/tariffs/types";
import { Button } from "~/features/common/ui/components/Button";
import { Input } from "~/features/common/ui/components/Field";
import { Swatch } from "~/features/common/ui/components/Swatch";
import { bandColor, DAY_OPTIONS, MAX_WINDOWS } from "~/features/common/tariffs/utils";
import type { TariffEdit } from "~/features/settings/utils";

/** "" for an empty box, otherwise the number typed. */
export const numberInput = (v: string): number | "" => (v === "" ? "" : +v);

const winControl =
  "h-10 rounded-lg border border-line bg-surface px-2.5 font-sans text-sm text-ink tabular-nums focus:border-brand focus:shadow-focus focus:outline-none";

const NEVER_APPLIES =
  "Never applies: the other rates already cover every hour. To use two rates, select “Use for all other times” on one of them, then remove this one.";

function WindowRow({
  window: w,
  onChange,
  onRemove,
}: {
  window: TimeWindow;
  onChange: (patch: Partial<TimeWindow>) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Days"
        className={winControl}
        value={w.days}
        onChange={(e) => onChange({ days: e.target.value as TimeWindow["days"] })}
      >
        {DAY_OPTIONS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <input
        type="time"
        step="300"
        aria-label="From"
        className={winControl}
        value={w.start}
        onChange={(e) => onChange({ start: e.target.value })}
      />
      <span className="text-[13px] text-ink-muted">to</span>
      <input
        type="time"
        step="300"
        aria-label="To"
        className={winControl}
        value={w.end}
        onChange={(e) => onChange({ end: e.target.value })}
      />
      {onRemove && (
        <Button variant="icon" aria-label="Remove time window" onClick={onRemove}>
          ×
        </Button>
      )}
    </div>
  );
}

/** One import rate: its name and price, and either its time windows or "all other times". */
export function BandEditor({
  band: b,
  index,
  used,
  removable,
  edit,
}: {
  band: TariffBand;
  index: number;
  /** Whether the rate applies at any minute of the week. */
  used: boolean;
  removable: boolean;
  edit: (e: TariffEdit) => void;
}) {
  return (
    <div className="flex flex-col items-start gap-2.5 rounded-xl border border-line-subtle p-4">
      <div className="flex w-full flex-wrap items-center gap-2.5">
        <Swatch color={bandColor(index)} size={10} />
        <Input
          type="text"
          maxLength={24}
          aria-label="Rate name"
          boxClassName="min-w-[140px] flex-1"
          value={b.name}
          onChange={(e) => edit({ type: "set-band", band: index, patch: { name: e.target.value } })}
        />
        <Input
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          aria-label={`${b.name} rate`}
          prefix="$"
          unit="per kWh"
          boxClassName="w-[190px] max-sm:w-full"
          value={b.rate}
          onChange={(e) => edit({ type: "set-band", band: index, patch: { rate: numberInput(e.target.value) } })}
        />
        {removable && (
          <Button
            variant="icon"
            aria-label={`Remove ${b.name}`}
            onClick={() => edit({ type: "remove-band", band: index })}
          >
            ×
          </Button>
        )}
      </div>
      {b.other ? (
        <div className="pl-5 text-[13px] text-ink-muted max-sm:pl-0">
          {used ? "Applies at all other times" : NEVER_APPLIES}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 pl-5 max-sm:pl-0">
            {b.windows.map((w, j) => (
              <WindowRow
                key={j}
                window={w}
                onChange={(patch) => edit({ type: "set-window", band: index, window: j, patch })}
                onRemove={
                  b.windows.length > 1 ? () => edit({ type: "remove-window", band: index, window: j }) : undefined
                }
              />
            ))}
          </div>
          {b.windows.length < MAX_WINDOWS && (
            <Button
              variant="link"
              size="sm"
              className="pl-5 max-sm:pl-0"
              onClick={() => edit({ type: "add-window", band: index })}
            >
              Add time window
            </Button>
          )}
          <Button
            variant="muted-link"
            size="sm"
            className="pl-5 max-sm:pl-0"
            onClick={() => edit({ type: "make-other", band: index })}
          >
            Use for all other times
          </Button>
        </>
      )}
    </div>
  );
}
