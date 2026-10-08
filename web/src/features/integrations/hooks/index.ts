import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { carsQuery } from "~/features/car/api";
import { MANAGE_COLOR, type NavPage } from "~/features/common/layout/utils";
import { useLive } from "~/features/common/live/hooks/useLive";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useNow } from "~/features/common/time/hooks";
import { useToast } from "~/features/common/ui/components/Toast";
import { integrationsQuery, removeInverter } from "~/features/integrations/api";
import type { InverterRole } from "~/features/integrations/types";
import { inverterState } from "~/features/integrations/utils";
import { homeQuery } from "~/features/home/api";
import { integrationIcon } from "~/features/home/utils";

/** What's connected (the query, for its loading and error states), with each inverter's live state. */
export function useInverters() {
  const query = useQuery(integrationsQuery);
  const live = useLive();
  const snapshot = useSnapshot();
  const now = useNow();
  const inverters = (query.data?.devices ?? []).map((d) => inverterState(d, live, snapshot, now));
  return { ...query, inverters };
}

/**
 * Stop reading an inverter, then refresh what's connected. `mutate` takes its name as shown, since its
 * reported model is gone from the stream once it's removed.
 */
export function useRemoveInverter(role: InverterRole, onRemoved?: () => void) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (_name: string) => removeInverter(role),
    onSuccess: (_, name) => {
      toast(`Stopped reading the ${name}.`);
      onRemoved?.();
      void qc.invalidateQueries({ queryKey: ["integrations"] });
    },
  });
}

/**
 * Integrations' pages, for the navigation to list, in the order the Integrations page has them: the inverters, the
 * smart-home accounts that are connected (the rest are on the Integrations page), the cars, then the grid, prices and
 * weather. Each counts as current on any page under it (an inverter's, a car's).
 */
export function useIntegrationNavPages(enabled: boolean): NavPage[] {
  const home = useQuery({ ...homeQuery, enabled }).data;
  const cars = useQuery({ ...carsQuery, enabled }).data;
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (!enabled) return [];
  // `at`: where its pages are, so it counts as current on any of them.
  const page = (at: string, link: NavPage["link"], label: string, icon: NavPage["icon"]): NavPage => ({
    key: at,
    label,
    icon,
    color: MANAGE_COLOR,
    link,
    active: path === at || path.startsWith(`${at}/`),
  });
  return [
    page("/integrations/sungrow", { to: "/integrations/sungrow" }, "Sungrow", "sun"),
    ...(home?.integrations ?? [])
      .filter((i) => i.account)
      .map((i) =>
        page(
          `/integrations/home/${i.id}`,
          { to: "/integrations/home/$integration", params: { integration: i.id } },
          i.name,
          integrationIcon(i),
        ),
      ),
    page(
      "/integrations/car",
      { to: "/integrations/car" },
      cars && cars.length > 1 ? "Electric vehicles" : "Electric vehicle",
      "car",
    ),
    page("/integrations/grid", { to: "/integrations/grid" }, "Grid", "grid"),
    page("/integrations/amber", { to: "/integrations/amber" }, "Amber Electric", "dollar"),
    page("/integrations/weather", { to: "/integrations/weather" }, "Weather", "cloudSun"),
  ];
}
