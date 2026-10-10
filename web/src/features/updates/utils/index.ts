import { COLOR } from "~/features/common/theme/utils/colors";
import type { Channel } from "~/features/updates/types";

/** Each release channel's name and colour: Nightly blue, Beta orange, Stable green, wherever it's shown. */
export const CHANNEL: Record<Channel, { label: string; color: string }> = {
  nightly: { label: "Nightly", color: COLOR.brand },
  beta: { label: "Beta", color: COLOR.export },
  stable: { label: "Stable", color: COLOR.good },
};
