import { createFileRoute } from "@tanstack/react-router";
import { HistoryPage } from "~/features/history/components/HistoryPage";
import { validateHistorySearch } from "~/features/history/utils/search";

export const Route = createFileRoute("/_app/history")({
  head: () => ({ meta: [{ title: "History · WattsMyPower" }] }),
  validateSearch: validateHistorySearch,
  component: HistoryPage,
});
