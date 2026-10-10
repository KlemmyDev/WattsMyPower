import { useQuery } from "@tanstack/react-query";
import type { Dispatch } from "react";
import { useSaveTariff } from "~/features/common/tariffs/hooks";
import { tariffQuery } from "~/features/common/tariffs/api";
import type { Tariff } from "~/features/common/tariffs/types";
import { Button } from "~/features/common/ui/components/Button";
import { HelpText } from "~/features/common/ui/components/Field";
import type { IconName } from "~/features/common/ui/components/Icon";
import { hhmm } from "~/features/common/formatting/utils/date";
import { MAX_BANDS, usedBands } from "~/features/common/tariffs/utils";
import { nowS } from "~/features/common/time/utils";
import { BandEditor } from "~/features/settings/components/BandEditor";
import { failure } from "~/features/common/settings/utils";
import type { EditorAction, EditorState, TariffEdit } from "~/features/settings/utils";
import { TariffTimeline } from "~/features/settings/components/TariffTimeline";

export const RATE_TYPES: { value: Tariff["type"]; label: string; icon: IconName }[] = [
  { value: "flat", label: "Single rate", icon: "bolt" },
  { value: "tou", label: "Time of use", icon: "clock" },
  { value: "amber", label: "Amber", icon: "dollar" },
];

export const RATE_HELP: Record<Tariff["type"], string> = {
  flat: "One price for grid electricity at any time of day.",
  tou: "Different rates at different times of day, for example peak, shoulder, and off-peak.",
  amber:
    "Amber's own prices for every 5 or 30 minutes, from your Amber account. Grid power and feed-in are costed at the price of the time.",
};

export function ImportRates({
  draft,
  edit,
  timeline = true,
}: {
  draft: Tariff;
  edit: (e: TariffEdit) => void;
  /** The day drawn under the rates (not where a chart beside them draws it). */
  timeline?: boolean;
}) {
  const used = usedBands(draft);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-semibold">Import rates</span>
        <HelpText>
          Set when each rate applies. The rate marked for all other times fills the gaps. A window from 00:00 to 00:00
          covers the whole day.
        </HelpText>
      </div>
      <div className="flex flex-col gap-3">
        {draft.bands.map((b, i) => (
          <BandEditor
            key={i}
            band={b}
            index={i}
            used={used.has(i)}
            removable={draft.bands.length > 2 && !b.other}
            edit={edit}
          />
        ))}
      </div>
      {draft.bands.length < MAX_BANDS && (
        <Button variant="outline" className="self-start" onClick={() => edit({ type: "add-band" })}>
          Add rate
        </Button>
      )}
      {timeline && <TariffTimeline tariff={draft} />}
    </div>
  );
}

/**
 * The tariff being edited: the draft if there is one, else the server's (from tariffQuery, refetched
 * on mount, rather than the live stream's copy).
 */
export function useRatesDraft(state: EditorState) {
  const query = useQuery(tariffQuery);
  // Always edit what the server has, not whatever the page last heard over the live stream.
  const server = query.isFetchedAfterMount && !query.isError ? query.data : undefined;
  return { query, draft: state.draft ?? server, dirty: state.draft !== null };
}

/** Save the draft, saying how it went in the editor's status line. */
export function useSaveRates(dispatch: Dispatch<EditorAction>) {
  const save = useSaveTariff();
  return {
    isPending: save.isPending,
    save: (draft: Tariff, onSaved?: () => void) => {
      dispatch({ type: "saving" });
      save.mutate(draft, {
        onSuccess: () => {
          dispatch({ type: "saved", message: `Saved at ${hhmm(nowS())}. Savings on every page now use these rates.` });
          onSaved?.();
        },
        onError: (err) => dispatch({ type: "failed", message: failure(err, "Check the rates and try again.") }),
      });
    },
  };
}

export function RatesLoading({ failed }: { failed: boolean }) {
  return (
    <div className="text-sm text-ink-muted">
      {failed ? "The rates could not be loaded. Reload the page to try again." : "Loading rates…"}
    </div>
  );
}
