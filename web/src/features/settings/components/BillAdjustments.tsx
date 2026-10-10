import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { billsQuery } from "~/features/bills/api";
import { spanLabel } from "~/features/bills/utils";
import type { SystemInfo } from "~/features/common/live/types";
import { useSaveSettings } from "~/features/common/settings/hooks";
import type { Settings } from "~/features/common/settings/types";
import { saveSettingsError } from "~/features/common/settings/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input } from "~/features/common/ui/components/Field";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { useToast } from "~/features/common/ui/components/Toast";
import { dollars, money } from "~/features/common/formatting/utils/number";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";

type Key = "bill_discount_pct" | "bill_credits_year" | "bill_budget";
type Values = Record<Key, string> & { bill_discount_on: Settings["bill_discount_on"] };

const KEYS: Key[] = ["bill_discount_pct", "bill_credits_year", "bill_budget"];
const NAMES: Record<Key, string> = {
  bill_discount_pct: "the discount",
  bill_credits_year: "credits a year",
  bill_budget: "the budget",
};
const DISCOUNT_ON: { value: Settings["bill_discount_on"]; label: string }[] = [
  { value: "usage", label: "Usage" },
  { value: "usage_supply", label: "Usage and supply" },
];

/** Saved values as the form shows them: blank for none. */
const valuesOf = (s: Settings): Values => ({
  ...(Object.fromEntries(KEYS.map((k) => [k, s[k] ? String(s[k]) : ""])) as Record<Key, string>),
  bill_discount_on: s.bill_discount_on ?? "usage",
});

/** A form value as saved: 0 for blank, NaN when it isn't a number. */
const saved = (v: string) => (v.trim() === "" ? 0 : Number(v));

/**
 * Bills → Rates & settings: what comes off a bill (the retailer's discount, and credits such as concessions), and a budget a
 * bill to hold it to. Bill totals across the app take them off; each day stays at the rates alone.
 */
export function BillAdjustments({ system: s }: { system: SystemInfo }) {
  const save = useSaveSettings();
  const toast = useToast();
  const [values, setValues] = useState(() => valuesOf(s));
  const [error, setError] = useState("");
  const changed: (keyof Values)[] = [
    ...KEYS.filter((k) => saved(values[k]) !== (s[k] || 0)),
    ...(values.bill_discount_on !== (s.bill_discount_on ?? "usage") ? (["bill_discount_on"] as const) : []),
  ];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const bad = KEYS.find((k) => changed.includes(k) && Number.isNaN(saved(values[k])));
    if (bad) return setError(`Enter a number for ${NAMES[bad]}, or leave it blank.`);
    const changes: Partial<Settings> = Object.fromEntries(
      changed.map((k) => [k, k === "bill_discount_on" ? values[k] : saved(values[k])]),
    );
    save.mutate(changes, {
      onSuccess: (next) => {
        setValues(valuesOf({ ...s, ...next }));
        toast("Saved. Bill estimates are updated.");
      },
      onError: (err) => setError(saveSettingsError(err)),
    });
  };

  const number = (key: Key, label: string, help: string, unit: "$" | "%") => (
    <Field label={label} help={help}>
      <Input
        type="number"
        inputMode="decimal"
        step={unit === "%" ? "0.5" : "1"}
        min="0"
        prefix={unit === "$" ? "$" : undefined}
        unit={unit === "%" ? "%" : undefined}
        value={values[key]}
        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
      />
    </Field>
  );

  return (
    <SettingsCard padded aria-labelledby="h-bill-adjust">
      <SettingsTitle
        id="h-bill-adjust"
        title="Discounts, credits and budget"
        sub="Optional. What comes off your bill besides feed-in, and what you'd like each bill to stay under."
      />
      <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] items-start gap-5">
          {number(
            "bill_discount_pct",
            "Discount",
            "A retailer's discount, such as for paying on time. Leave it blank if your rates already include it.",
            "%",
          )}
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold">The discount comes off</span>
            <Segmented
              label="The discount comes off"
              options={DISCOUNT_ON}
              value={values.bill_discount_on}
              onChange={(v) => setValues((x) => ({ ...x, bill_discount_on: v }))}
              className="grid grid-cols-2"
              buttonClassName="justify-center px-3 py-2.5"
            />
            <span className="text-xs text-ink-muted">Your plan&apos;s terms say which</span>
          </div>
          {number(
            "bill_credits_year",
            "Credits a year",
            "Concessions and government rebates, in dollars a year. They're spread across each bill by its days.",
            "$",
          )}
          {number(
            "bill_budget",
            "Budget a bill",
            "What you'd like each bill to stay under. The Bills page shows when one is heading over.",
            "$",
          )}
        </div>
        <Effect />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={!changed.length || save.isPending}>
            {save.isPending ? "Saving…" : "Save discounts and budget"}
          </Button>
          <HelpText tone="bad" role="alert">
            {error}
          </HelpText>
        </div>
      </form>
    </SettingsCard>
  );
}

/** What the saved discount, credits and budget come to on the current bill. */
function Effect() {
  const bills = useQuery(billsQuery).data;
  const exp = bills?.current.expected;
  if (!bills || !exp) return null;
  const off: string[] = [
    exp.discount > 0 && `${money(exp.discount)} of discount`,
    exp.credits > 0 && `${money(exp.credits)} of credits`,
  ].filter((x) => typeof x === "string");
  const budget = bills.budget;
  if (!off.length && !budget) return null;
  const total = exp.net_cost;
  const over = budget ? total - budget : 0;
  return (
    <div className="rounded-2xl bg-canvas/60 px-5 py-4 text-sm leading-[22px] text-pretty text-ink-muted light:bg-canvas">
      {off.length
        ? `${capital(off.join(" and "))} come off the current bill (${spanLabel(bills.period)}). It's`
        : `The current bill (${spanLabel(bills.period)}) is`}{" "}
      expected to {total < 0 ? `be a credit of about ${dollars(-total)}` : `come to about ${dollars(total)}`}
      {budget ? `, ${dollars(Math.abs(over))} ${over > 0 ? "over" : "under"} your ${dollars(budget)} budget.` : "."}
    </div>
  );
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
