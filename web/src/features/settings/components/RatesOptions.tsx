import { useQuery } from "@tanstack/react-query";
import type { Dispatch } from "react";
import { amberQuery } from "~/features/amber/api";
import { COLOR } from "~/features/common/theme/utils/colors";
import type { Tariff } from "~/features/common/tariffs/types";
import { HelpText } from "~/features/common/ui/components/Field";
import { useToast } from "~/features/common/ui/components/Toast";
import { numberInput } from "~/features/settings/components/BandEditor";
import {
  ChoiceTiles,
  NumberRow,
  OptionList,
  SaveBanner,
  SettingsSection,
} from "~/features/settings/components/SettingsSection";
import {
  ImportRates,
  RATE_HELP,
  RATE_TYPES,
  SourceLine,
  useSaveRates,
} from "~/features/settings/components/TariffEditor";
import type { EditorAction, EditorState, TariffEdit } from "~/features/settings/utils";

/**
 * Bills → Rates & settings, the rates: the rate type as rows, the time-of-use rates (when that's the type), and grid
 * power, feed-in and the supply charge as rows. Edits go to the draft (drawn in the chart beside it as they're typed),
 * saved or discarded together from the bar that rises while there are any.
 */
export function RatesOptions({
  draft,
  state,
  dispatch,
  dirty,
  onDiscard,
}: {
  draft: Tariff;
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  dirty: boolean;
  onDiscard: () => void;
}) {
  const toast = useToast();
  const save = useSaveRates(dispatch);
  const amber = useQuery(amberQuery).data;
  const tou = draft.type === "tou";
  const dynamic = draft.type === "amber";
  // Amber is offered once it's connected (or while the rates already use it).
  const types = RATE_TYPES.filter((r) => r.value !== "amber" || dynamic || !!amber?.site_id);
  const edit = (e: TariffEdit) => dispatch({ type: "edit", base: draft, edit: e });
  const money = (field: "flat_rate" | "feed_in_rate" | "supply_charge", label: string, help: string, unit: string) => (
    <NumberRow
      label={label}
      help={help}
      prefix="$"
      unit={unit}
      step="0.01"
      value={String(draft[field])}
      onChange={(v) => edit({ type: "set-field", field, value: numberInput(v) })}
    />
  );

  return (
    <SettingsSection
      id="rates"
      className="scroll-mt-6"
      title="Rates"
      sub="Find these on your electricity bill. Savings, grid cost and feed-in credit on every page use them."
    >
      {draft.source && !state.imported && <SourceLine source={draft.source} />}
      <ChoiceTiles
        label="Rate type"
        rows
        color={COLOR.good}
        options={types.map((r) => ({ value: r.value, title: r.label, sub: RATE_HELP[r.value], icon: r.icon }))}
        value={draft.type}
        onChange={(v) => edit({ type: "set-rate-type", value: v })}
      />
      {dynamic && (
        <HelpText className="text-[13px] leading-5">
          For any time Amber has no price for, the fallback rates below are used instead.
        </HelpText>
      )}
      {tou && <ImportRates draft={draft} edit={edit} timeline={false} />}
      <OptionList>
        {!tou &&
          money(
            "flat_rate",
            dynamic ? "Fallback import rate" : "Grid import rate",
            dynamic ? "When Amber has no price." : "What you pay for grid power.",
            "/kWh",
          )}
        {money(
          "feed_in_rate",
          dynamic ? "Fallback feed-in" : "Feed-in tariff",
          dynamic ? "When Amber has no price." : "What you earn for solar sent to the grid.",
          "/kWh",
        )}
        {money(
          "supply_charge",
          "Daily supply charge",
          dynamic ? "Amber's network charge and membership, a day." : "Your retailer's fixed daily charge.",
          "/day",
        )}
      </OptionList>
      <SaveBanner
        dirty={dirty}
        pending={save.isPending}
        error={state.status?.bad ? state.status.text : undefined}
        saveLabel="Save rates"
        onDiscard={onDiscard}
        onSave={() => save.save(draft, () => toast("Rates saved. Savings on every page now use them."))}
      />
    </SettingsSection>
  );
}
