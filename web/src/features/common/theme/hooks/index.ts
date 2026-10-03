import { useEffect, useSyncExternalStore } from "react";
import { STORE_THEME } from "~/features/common/storage/utils";
import {
  applyTheme,
  LIGHT_QUERY,
  savedTheme,
  saveTheme,
  subscribeTheme,
  themeChanged,
  type ThemeChoice,
} from "~/features/common/theme/utils";

/** This browser's theme choice, and a setter that saves and shows a new one. */
export function useThemeChoice(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const choice = useSyncExternalStore(subscribeTheme, savedTheme, () => "dark" as const);
  return [choice, saveTheme];
}

/**
 * Keeps the theme current while the app is open: follows the device between light and dark while
 * the choice is "System", and picks up a choice made in another tab. Use it once, at the root.
 */
export function useThemeSync() {
  useEffect(() => {
    const system = matchMedia(LIGHT_QUERY);
    const onSystem = () => applyTheme();
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORE_THEME && e.key !== null) return;
      applyTheme();
      themeChanged();
    };
    system.addEventListener("change", onSystem);
    addEventListener("storage", onStorage);
    return () => {
      system.removeEventListener("change", onSystem);
      removeEventListener("storage", onStorage);
    };
  }, []);
}
