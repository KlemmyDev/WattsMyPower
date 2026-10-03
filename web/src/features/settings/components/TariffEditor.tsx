import { useQuery } from "@tanstack/react-query";
import type { Dispatch, ReactNode, Ref } from "react";
import { amberQuery } from "~/features/amber/api";
import { useSaveTariff } from "~/features/common/tariffs/hooks";
import { tariffQuery } from "~/features/common/tariffs/api";
import type { PlanTariff } from "~/features/settings/types";
import type { Tariff } from "~/features/common/tariffs/types";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input } from "~/features/common/ui/components/Field";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { cn } from "~/features/common/ui/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { MAX_BANDS, usedBands } from "~/features/common/tariffs/utils";
import { nowS } from "~/features/common/time/utils";
import { BandEditor, numberInput } from "~/features/settings/components/BandEditor";
import { failure } from "~/features/common/settings/utils";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";
import type { EditorAction, EditorState, TariffEdit } from "~/features/settings/utils";
import { TariffTimeline } from "~/features/settings/components/TariffTimeline";

const RATE_TYPES: { value: Tariff["type"]; label: string }[] = [
  { value: "flat", label: "Single rate" },
  { value: "tou", label: "Time of use" },
  { value: "amber", label: "Amber" },
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

function ImportNote({ plan }: { plan: PlanTariff }) {
  return (
    <div role="status" className="rounded-xl bg-brand-subtle px-4 py-3.5 text-[13px] leading-5 text-ink-muted">
      <b className="font-semibold text-ink">
        Loaded {plan.plan.brand} · {plan.plan.name}.
      </b>{" "}
      Check the rates below, then select Save rates.
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
    <div className="rounded-[10px] bg-canvas px-3.5 py-2.5 text-[13px] leading-5 text-ink-muted">
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
 * The "Electricity rates" card. Edits a draft of the server's tariff (from tariffQuery, refetched on
 * mount, rather than the live stream's copy) and saves it with Save rates.
 */
export function TariffEditor({
  ref,
  state,
  dispatch,
}: {
  ref: Ref<HTMLElement>;
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}) {
  const query = useQuery(tariffQuery);
  const amber = useQuery(amberQuery).data;
  const save = useSaveTariff();
  // Always edit what the server has, not whatever the page last heard over the live stream.
  const server = query.isFetchedAfterMount && !query.isError ? query.data : undefined;
  const draft = state.draft ?? server;
  const dirty = state.draft !== null;

  let body: ReactNode;
  if (!draft) {
    body = (
      <div className="text-sm text-ink-muted">
        {query.isError ? "The rates could not be loaded. Reload the page to try again." : "Loading rates…"}
      </div>
    );
  } else {
    const tou = draft.type === "tou";
    const dynamic = draft.type === "amber";
    // Amber is offered once it's connected (or while the rates already use it).
    const types = RATE_TYPES.filter((r) => r.value !== "amber" || dynamic || !!amber?.site_id);
    const edit = (e: TariffEdit) => dispatch({ type: "edit", base: draft, edit: e });
    const saveRates = () => {
      dispatch({ type: "saving" });
      save.mutate(draft, {
        onSuccess: () =>
          dispatch({ type: "saved", message: `Saved at ${hhmm(nowS())}. Savings on every page now use these rates.` }),
        onError: (err) => dispatch({ type: "failed", message: failure(err, "Check the rates and try again.") }),
      });
    };
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
        {state.imported ? <ImportNote plan={state.imported} /> : draft.source && <SourceLine source={draft.source} />}
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Rate type</span>
          <Segmented
            label="Rate type"
            className="self-start"
            options={types}
            value={draft.type}
            onChange={(v) => v !== draft.type && edit({ type: "set-rate-type", value: v })}
          />
          <HelpText>{RATE_HELP[draft.type]}</HelpText>
        </div>
        {dynamic && (
          <HelpText className="text-[13px] leading-5">
            For any time Amber has no price for, such as before your prices were fetched or while Amber can't be
            reached, the fallback rates below are used instead. The Overview says how much was costed that way.
          </HelpText>
        )}
        {tou ? (
          <ImportRates draft={draft} edit={edit} />
        ) : (
          <div className={fieldGrid}>
            <MoneyField
              label={dynamic ? "Fallback import rate" : "Grid import rate"}
              unit="per kWh"
              help={
                dynamic ? "Used for grid power when Amber has no price" : "What you pay for electricity from the grid"
              }
              value={draft.flat_rate}
              onChange={(value) => edit({ type: "set-field", field: "flat_rate", value })}
            />
          </div>
        )}
        <div className={fieldGrid}>
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-4">
          <span className={cn("min-h-5 text-[13px]", state.status?.bad ? "text-bad" : "text-ink-faint")}>
            {state.status?.text}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" disabled={!dirty} onClick={discard}>
              Discard changes
            </Button>
            <Button size="sm" disabled={!dirty} onClick={saveRates}>
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
