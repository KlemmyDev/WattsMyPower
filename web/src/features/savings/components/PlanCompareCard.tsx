import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { ApiError, errorMessage } from "~/features/common/api/utils";
import { brandsQuery } from "~/features/common/plans/api";
import { planCompareQuery } from "~/features/savings/api";
import type { Brand } from "~/features/common/plans/types";
import type { Savings } from "~/features/savings/types";
import { Button } from "~/features/common/ui/components/Button";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Field, Input, Select } from "~/features/common/ui/components/Field";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { cn } from "~/features/common/ui/utils";
import { store, STORE_BRAND, STORE_POSTCODE } from "~/features/common/storage/utils";
import { PlanResults } from "~/features/savings/components/PlanResults";

type Request = { brand: string; postcode: string };

const POSTCODE = /^\d{4}$/;

export function PlanCompareCard({ savings }: { savings: Savings | undefined }) {
  const tariffBrand = useSystem()?.tariff.source?.brand_id;
  const brands = useQuery(brandsQuery);
  // Where the last comparison looked, remembered in this browser.
  const [savedPostcode] = useState(() => store.get(STORE_POSTCODE));
  const [savedBrand] = useState(() => store.get(STORE_BRAND));

  const [postcode, setPostcode] = useState(savedPostcode);
  const [brandChoice, setBrandChoice] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Request | null>(null);
  const [formError, setFormError] = useState("");

  const listed = (id: string | undefined) => (id && brands.data?.some((b) => b.id === id) ? id : "");
  // Preselect the retailer last compared, or the one the tariff was imported from.
  const defaultBrand = listed(savedBrand || tariffBrand);
  const brand = brandChoice ?? defaultBrand;

  // Each plan is priced on whole days of usage, so comparing needs a few days of readings.
  const needsDays = !!savings && savings.profile_days < savings.min_profile_days;
  // Compare straight away when we already know where to look and have enough readings.
  const auto =
    savings && !needsDays && POSTCODE.test(savedPostcode) && defaultBrand
      ? { brand: defaultBrand, postcode: savedPostcode }
      : null;
  const request = formError ? null : (submitted ?? auto);

  const compare = useQuery({
    ...planCompareQuery(request?.brand ?? "", request?.postcode ?? ""),
    enabled: request != null,
  });
  const busy = compare.isFetching && !compare.isSuccess;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const pc = postcode.trim();
    if (!POSTCODE.test(pc)) return setFormError("Enter a four-digit postcode.");
    if (!brand) return setFormError("Select a retailer.");
    store.set(STORE_POSTCODE, pc);
    store.set(STORE_BRAND, brand);
    setFormError("");
    setSubmitted({ brand, postcode: pc });
    // Asking again for the same plans retries a comparison that failed.
    if (request?.brand === brand && request.postcode === pc && compare.isError) void compare.refetch();
  }

  let status: ReactNode = null;
  if (needsDays)
    status = (
      <Message>
        Plan comparison needs at least {savings.min_profile_days} full days of readings, so each plan is priced on whole
        days of your usage. You have {savings.profile_days} so far.
      </Message>
    );
  else if (formError) status = <Message bad>{formError}</Message>;
  else if (!request)
    status = savings && (
      <Message>Enter your postcode and a retailer to price their current plans on your own usage.</Message>
    );
  else if (busy)
    status = (
      <Message>
        Pricing every {brandName(brands.data, request.brand)} plan on your usage. The first comparison can take a few
        seconds.
      </Message>
    );
  else if (compare.isError)
    status = (
      <Message bad>
        {errorMessage(
          compare.error,
          compare.error instanceof ApiError ? "The comparison didn't work. Try again." : undefined,
        )}
      </Message>
    );

  return (
    <Card aria-labelledby="h-cmp">
      <TitleBlock
        id="h-cmp"
        title="Compare electricity plans"
        sub="Estimated yearly cost of each plan using your own solar, battery, and grid data"
      />
      <form
        noValidate
        onSubmit={submit}
        className="grid grid-cols-[120px_minmax(180px,320px)_auto] items-end justify-start gap-3 max-md:grid-cols-[100px_minmax(0,1fr)] max-md:justify-stretch"
      >
        <Field label="Postcode">
          <Input
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={4}
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
          />
        </Field>
        <Field label="Retailer">
          <Select value={brand} onChange={(e) => setBrandChoice(e.target.value)}>
            {brands.isSuccess ? (
              <>
                <option value="">Select a retailer</option>
                {brands.data.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </>
            ) : (
              <option value="">{brands.isError ? "Retailers unavailable" : "Loading retailers…"}</option>
            )}
          </Select>
        </Field>
        <Button
          type="submit"
          disabled={needsDays || busy}
          className="text-sm max-md:col-span-full max-md:justify-center"
        >
          Compare plans
        </Button>
      </form>
      {status ?? (compare.data && <PlanResults data={compare.data} />)}
    </Card>
  );
}

const brandName = (brands: Brand[] | undefined, id: string) => brands?.find((b) => b.id === id)?.name ?? id;

function Message({ bad, children }: { bad?: boolean; children: ReactNode }) {
  return <div className={cn("py-1 text-sm", bad ? "text-bad" : "text-ink-muted")}>{children}</div>;
}
