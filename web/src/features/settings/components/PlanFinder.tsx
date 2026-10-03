import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { usePlanTariff } from "~/features/settings/hooks/usePlanTariff";
import { brandsQuery } from "~/features/common/plans/api";
import { planSearchQuery } from "~/features/settings/api";
import type { PlanSearch, PlanSummary, PlanTariff } from "~/features/settings/types";
import { Button } from "~/features/common/ui/components/Button";
import { Field, Input, Select } from "~/features/common/ui/components/Field";
import { Pill } from "~/features/common/ui/components/Pill";
import { useToast } from "~/features/common/ui/components/Toast";
import { cn } from "~/features/common/ui/utils";
import { cents, money, plural } from "~/features/common/formatting/utils/number";
import { store, STORE_BRAND, STORE_POSTCODE } from "~/features/common/storage/utils";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { failure } from "~/features/common/settings/utils";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";

const PLAN_TYPE: Record<string, string> = {
  MARKET: "Market offer",
  STANDING: "Standing offer",
  REGULATED: "Regulated offer",
};

type SearchParams = { brand: string; postcode: string; q: string };

function Message({ bad, children }: { bad?: boolean; children: string }) {
  return <p className={cn("my-3 text-xs", bad ? "text-bad" : "text-ink-muted")}>{children}</p>;
}

function PlanRow({ plan: p, loading, onUse }: { plan: PlanSummary; loading: boolean; onUse: () => void }) {
  const tags = [
    PLAN_TYPE[p.type] || p.type,
    p.pricing === "tou" ? "Time of use" : "Single rate",
    p.controlled_load ? "Controlled load" : "",
    p.demand ? "Demand charges" : "",
  ].filter(Boolean);
  const rates = p.rates.map((x) => `${x.name === "All times" ? "Usage" : x.name} ${cents(x.price)}`).join(" · ");
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line-subtle px-4 py-3.5 last:border-b-0 max-md:flex-col max-md:items-stretch">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="text-sm font-semibold">{p.name}</div>
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <Pill key={t} size="sm">
              {t}
            </Pill>
          ))}
        </div>
        <div className="text-[13px] text-ink-muted tabular-nums">
          {rates || "Rates not listed"} per kWh · Supply {money(p.supply)}/day · Feed-in {cents(p.feed_in)}
        </div>
        <div className="font-mono text-[11px] text-ink-faint">
          Plan {p.id} · updated {p.updated || "—"}
        </div>
      </div>
      <Button variant="outline" className="flex-none" disabled={loading} onClick={onUse}>
        {loading ? "Loading…" : "Use this plan"}
      </Button>
    </div>
  );
}

function PlanResults({
  result: r,
  loadingId,
  onUse,
}: {
  result: PlanSearch;
  loadingId: string | undefined;
  onUse: (plan: string) => void;
}) {
  const [showControlled, setShowControlled] = useState(false);
  const plans = r.plans.filter((p) => showControlled || !p.controlled_load);
  const hidden = r.plans.length - plans.length;
  const limit = r.limit || 400;
  const summary = !r.plans.length
    ? `${r.brand} has no current residential electricity plans for ${r.postcode}.`
    : `${plans.length} ${plural(plans.length, "plan")} from ${r.brand} for ${r.postcode}${hidden ? `, plus ${hidden} with controlled load` : ""}.` +
      (r.truncated
        ? ` ${r.brand} publishes more than ${limit} plans here, so only the first ${limit} were checked. Add part of your plan name to narrow the search.`
        : "");
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-ink-muted">{summary}</span>
        {r.plans.some((p) => p.controlled_load) && (
          <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-muted">
            <input type="checkbox" checked={showControlled} onChange={(e) => setShowControlled(e.target.checked)} />
            Show plans with controlled load{hidden ? ` (${hidden})` : ""}
          </label>
        )}
      </div>
      <div className="flex max-h-[520px] flex-col overflow-y-auto rounded-xl border border-line-subtle">
        {plans.map((p) => (
          <PlanRow key={p.id} plan={p} loading={loadingId === p.id} onUse={() => onUse(p.id)} />
        ))}
      </div>
    </>
  );
}

/** "Find your plan": search Energy Made Easy for a retailer's plans and load one into the rates editor. */
export function PlanFinder({ onImport }: { onImport: (plan: PlanTariff) => void }) {
  return (
    <SettingsCard padded aria-labelledby="h-find">
      <SettingsTitle
        id="h-find"
        title="Find your plan"
        sub="Search the current plans retailers publish to Energy Made Easy, then load one into the rates below. Prices include GST."
      />
      <PlanSearch onImport={onImport} />
    </SettingsCard>
  );
}

/** The plan search form and its results, without a card (the set-up guide shows it too). */
export function PlanSearch({ onImport }: { onImport: (plan: PlanTariff) => void }) {
  const system = useSystem();
  const toast = useToast();
  const brands = useQuery(brandsQuery);
  const planTariff = usePlanTariff();
  const [postcode, setPostcode] = useState(() => store.get(STORE_POSTCODE));
  const [storedBrand] = useState(() => store.get(STORE_BRAND));
  const [chosenBrand, setChosenBrand] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [problem, setProblem] = useState("");
  const [params, setParams] = useState<SearchParams | null>(null);
  // A new search starts with plans that need a controlled-load meter hidden again.
  const [searchCount, setSearchCount] = useState(0);
  const search = useQuery({
    ...planSearchQuery(params?.brand ?? "", params?.postcode ?? "", params?.q ?? ""),
    enabled: params !== null,
  });

  // Until a retailer is picked, preselect the last one searched, or the one the saved rates came from.
  const defaultBrand = storedBrand || system?.tariff.source?.brand_id || "";
  const brand = chosenBrand ?? (brands.data?.some((b) => b.id === defaultBrand) ? defaultBrand : "");
  const brandName = (id: string) => brands.data?.find((b) => b.id === id)?.name ?? id;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const pc = postcode.trim();
    if (!/^\d{4}$/.test(pc)) return setProblem("Enter a four-digit postcode.");
    if (!brand) return setProblem("Select your retailer.");
    setProblem("");
    store.set(STORE_POSTCODE, pc);
    store.set(STORE_BRAND, brand);
    setSearchCount((n) => n + 1);
    const next = { brand, postcode: pc, q: q.trim() };
    const same = params && params.brand === next.brand && params.postcode === next.postcode && params.q === next.q;
    if (!same) setParams(next);
    else if (search.isError) void search.refetch();
  };

  const loadPlan = (plan: string) => {
    if (!params || planTariff.isPending) return;
    planTariff.mutate(
      { brand: params.brand, plan },
      { onSuccess: onImport, onError: (err) => toast(failure(err, "That plan couldn't be loaded.")) },
    );
  };

  let results = null;
  if (problem) results = <Message bad>{problem}</Message>;
  else if (params && search.isPending)
    results = (
      <Message>{`Loading plans from ${brandName(params.brand)}. The first search can take a few seconds.`}</Message>
    );
  else if (search.isError)
    results = <Message bad>{failure(search.error, "The search didn't work. Try again.")}</Message>;
  else if (search.data)
    results = (
      <PlanResults
        key={searchCount}
        result={search.data}
        loadingId={planTariff.isPending ? planTariff.variables?.plan : undefined}
        onUse={loadPlan}
      />
    );

  return (
    <>
      <form
        className="grid grid-cols-[120px_minmax(180px,1.2fr)_minmax(160px,1fr)_auto] items-end gap-3 max-md:grid-cols-2"
        onSubmit={submit}
      >
        <Field label="Postcode">
          <Input
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={4}
            pattern="\d{4}"
            required
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
          />
        </Field>
        <Field label="Retailer">
          <Select required value={brand} onChange={(e) => setChosenBrand(e.target.value)}>
            {brands.isPending ? (
              <option value="">Loading retailers…</option>
            ) : brands.isError ? (
              <option value="">Retailers unavailable</option>
            ) : (
              <>
                <option value="">Select your retailer</option>
                {brands.data.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </>
            )}
          </Select>
        </Field>
        <Field label="Plan name (optional)" className="max-md:col-span-full">
          <Input placeholder="For example, solar" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <Button type="submit" className="text-sm max-md:col-span-full" disabled={search.isFetching}>
          Search plans
        </Button>
      </form>
      <div>{results}</div>
    </>
  );
}
