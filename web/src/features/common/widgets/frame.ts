import { createContext, useContext } from "react";
import type { GroupId } from "~/features/common/widgets/types";

/**
 * Set around each widget on a dashboard: which group its card comes from. A page's card shown as a widget reads it to
 * say which page it's from and link there (HeroCard), which it doesn't need to on its own page.
 */
export const WidgetFrame = createContext<{ group: GroupId } | null>(null);

export const useWidgetFrame = () => useContext(WidgetFrame);
