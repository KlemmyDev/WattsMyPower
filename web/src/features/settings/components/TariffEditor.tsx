import { useQuery } from "@tanstack/react-query";
import type { Dispatch, ReactNode, Ref } from "react";
import { amberQuery } from "~/features/amber/api";
import { useSaveTariff } from "~/features/common/tariffs/hooks";
import { tariffQuery } from "~/features/common/tariffs/api";
import type { PlanTariff } from "~/features/settings/types";
import type { Tariff } from "~/features/common/tariffs/types";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input } from "~/features/common/ui/components/Field";
import type { IconName } from "~/features/common/ui/components/Icon";
import { COLOR } from "~/features/common/theme/utils/colors";
import { ChoiceTiles } from "~/features/settings/components/SettingsSection";
import { cn } from "~/features/common/ui/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { MAX_BANDS, usedBands } from "~/features/common/tariffs/utils";
import { nowS } from "~/features/common/time/utils";
import { BandEditor, numberInput } from "~/features/settings/components/BandEditor";
import { failure } from "~/features/common/settings/utils";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";
import type { EditorAction, EditorState, TariffEdit } from "~/features/settings/utils";
import { TariffTimeline } from "~/features/settings/components/TariffTimeline";

const RATE_TYPES: { value: Tariff["type"]; label: string; icon: IconName }[] = [
  { value: "flat", label: "Single rate", icon: "bolt" },
  { value: "tou", label: "Time of use", icon: "clock" },
  { value: "amber", label: "Amber", icon: "dollar" },
];

const RATE_HELP: Record<Tariff["type"], string> = {
  flat: "One price for grid electricity at any time of day.",
  tou: "Different rates at different times of day, for example peak, shoulder, and off-peak.",
  amber:
    "Amber's own prices for every 5 or 30 minutes, from your Amber account. Grid power and feed-in are costed at the price of the time.",
};

const fieldGrid = "grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-5";

function MoneyField({
  label,
  unit,
  help,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  help: string;
  value: number | "";
  onChange: (v: number | "") => void;
}) {
  return (
    <Field label={label} help={help}>
      <Input
        type="number"
        step="0.01"
        min="0"
        inputMode="decimal"
        prefix="$"
        unit={unit}
        value={value}
        onChange={(e) => onChange(numberInput(e.target.value))}
      />
    </Field>
  );
}

function ImportNote({ plan, saveLabel }: { plan: PlanTariff; saveLabel: string }) {
  return (
    <div
      role="status"
      className="animate-pop rounded-2xl bg-brand-subtle px-5 py-4 text-[13px] leading-5 text-ink-muted"
    >
      <b className="font-semibold text-ink">
        Loaded {plan.plan.brand} · {plan.plan.name}.
      </b>{" "}
      Check the rates below, then select {saveLabel}.
      {plan.notes.length > 0 && (
        <ul className="mt-2 mb-0 list-disc pl-[18px]">
          {plan.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SourceLine({ source }: { source: NonNullable<Tariff["source"]> }) {
  return (
    <div className="rounded-2xl bg-canvas/60 px-4 py-3 text-[13px] leading-5 text-ink-muted light:bg-canvas">
      Imported from {source.brand} · {source.plan_name} (plan {source.plan_id}), published {source.updated || "—"}. Edit
      anything that differs from your bill.
    </div>
  );
}

function ImportRates({ draft, edit }: { draft: Tariff; edit: (e: TariffEdit) => void }) {
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
      <TariffTimeline tariff={draft} />
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

/**
 * The rates themselves: where they came from, the rate type, import rates, feed-in and supply.
 * Edits go to the draft; `saveLabel` is the button that saves them, for the note after loading a plan.
 */
export function RatesFields({
  draft,
  state,
  dispatch,
  saveLabel = "Save rates",
}: {
  draft: Tariff;
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  saveLabel?: string;
}) {
  const amber = useQuery(amberQuery).data;
  const tou = draft.type === "tou";
  const dynamic = draft.type === "amber";
  // Amber is offered once it's connected (or while the rates already use it).
  const types = RATE_TYPES.filter((r) => r.value !== "amber" || dynamic || !!amber?.site_id);
  const edit = (e: TariffEdit) => dispatch({ type: "edit", base: draft, edit: e });
  return (
    <>
      {state.imported ? (
        <ImportNote plan={state.imported} saveLabel={saveLabel} />
      ) : (
        draft.source && <SourceLine source={draft.source} />
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold">Rate type</span>
        <ChoiceTiles
          label="Rate type"
          min="12rem"
          phone={1}
          color={COLOR.good}
          options={types.map((r) => ({ value: r.value, title: r.label, sub: RATE_HELP[r.value], icon: r.icon }))}
          value={draft.type}
          onChange={(v) => edit({ type: "set-rate-type", value: v })}
        />
      </div>
      {dynamic && (
        <HelpText className="text-[13px] leading-5">
          For any time Amber has no price for, such as before your prices were fetched or while Amber can't be reached,
          the fallback rates below are used instead. The Overview says how much was costed that way.
        </HelpText>
      )}
      {tou && <ImportRates draft={draft} edit={edit} />}
      {/* On a single rate or Amber, its import rate sits beside feed-in and the supply charge. */}
      <div className={fieldGrid}>
        {!tou && (
          <MoneyField
            label={dynamic ? "Fallback import rate" : "Grid import rate"}
            unit="per kWh"
            help={
              dynamic ? "Used for grid power when Amber has no price" : "What you pay for electricity from the grid"
            }
            value={draft.flat_rate}
            onChange={(value) => edit({ type: "set-field", field: "flat_rate", value })}
          />
        )}
        <MoneyField
          label={dynamic ? "Fallback feed-in tariff" : "Feed-in tariff"}
          unit="per kWh"
          help={
            dynamic
              ? "Used for solar sent to the grid when Amber has no price"
              : "What you earn for solar sent to the grid"
          }
          value={draft.feed_in_rate}
          onChange={(value) => edit({ type: "set-field", field: "feed_in_rate", value })}
        />
        <MoneyField
          label="Daily supply charge"
          unit="per day"
          help={
            dynamic
              ? "Amber's daily network charge plus its membership fee as a daily amount. Both are on your Amber bill."
              : "Fixed daily charge from your retailer"
          }
          value={draft.supply_charge}
          onChange={(value) => edit({ type: "set-field", field: "supply_charge", value })}
        />
      </div>
    </>
  );
}

export function RatesLoading({ failed }: { failed: boolean }) {
  return (
    <div className="text-sm text-ink-muted">
      {failed ? "The rates could not be loaded. Reload the page to try again." : "Loading rates…"}
    </div>
  );
}

/** The "Electricity rates" card: edits a draft of the server's tariff and saves it with Save rates. */
export function TariffEditor({
  ref,
  state,
  dispatch,
}: {
  ref: Ref<HTMLElement>;
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}) {
  const { query, draft, dirty } = useRatesDraft(state);
  const save = useSaveRates(dispatch);

  let body: ReactNode;
  if (!draft) {
    body = <RatesLoading failed={query.isError} />;
  } else {
    const discard = () => {
      dispatch({ type: "discard" });
      void query.refetch();
    };

    body = (
      <>
        <SettingsTitle
          id="h-rates"
          title="Electricity rates"
          sub="Used to calculate savings, grid cost, and feed-in credit. Find these on your electricity bill."
        />
        <RatesFields draft={draft} state={state} dispatch={dispatch} />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-4">
          <span className={cn("min-h-5 text-[13px]", state.status?.bad ? "text-bad" : "text-ink-faint")}>
            {state.status?.text}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" disabled={!dirty} onClick={discard}>
              Discard changes
            </Button>
            <Button size="sm" disabled={!dirty} onClick={() => save.save(draft)}>
              Save rates
            </Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <SettingsCard padded ref={ref} aria-labelledby="h-rates">
      {body}
    </SettingsCard>
  );
}
