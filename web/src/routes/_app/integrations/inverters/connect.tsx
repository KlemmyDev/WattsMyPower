import { createFileRoute, redirect } from "@tanstack/react-router";
import { brandSlug } from "~/features/integrations/utils";

/** Connecting had one page for every brand: each brand has its own now (/integrations/inverters/connect?brand=GoodWe →
 * /integrations/inverters/goodwe/connect); without a brand, it's choosing one. */
export const Route = createFileRoute("/_app/integrations/inverters/connect")({
  beforeLoad: ({ search }) => {
    const brand = (search as Record<string, unknown>).brand;
    throw typeof brand === "string" && brand
      ? redirect({ to: "/integrations/inverters/$brand/connect", params: { brand: brandSlug(brand) }, replace: true })
      : redirect({ to: "/integrations/inverters", replace: true });
  },
});
