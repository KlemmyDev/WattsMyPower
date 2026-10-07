import { createFileRoute } from "@tanstack/react-router";
import { STORE_HOME_RANGE, store } from "~/features/common/storage/utils";
import { RoomPage } from "~/features/home/components/RoomPage";
import type { Range } from "~/features/home/utils";

const isRange = (v: unknown): v is Range => v === "today" || v === "week" || v === "month";

/** `range`: the period shown, as on Home (left out, the one last chosen in this browser, else 7 days). */
type Search = { range?: Range };

/** A room: the plugs and appliances grouped under its name, together and one by one. */
export const Route = createFileRoute("/_app/home_/rooms/$room")({
  validateSearch: (s: Record<string, unknown>): Search => ({ range: isRange(s.range) ? s.range : undefined }),
  head: ({ params }) => ({ meta: [{ title: `${params.room} · WattsMyPower` }] }),
  component: RoomRoute,
});

function RoomRoute() {
  const { room } = Route.useParams();
  const { range } = Route.useSearch();
  const remembered = store.get(STORE_HOME_RANGE);
  return <RoomPage room={room} range={range ?? (isRange(remembered) ? remembered : "week")} />;
}
