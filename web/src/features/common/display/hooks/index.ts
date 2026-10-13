import { useEffect, useSyncExternalStore } from "react";
import { STORE_DISPLAY } from "~/features/common/storage/utils";
import {
  applyDisplay,
  DEFAULT_DISPLAY,
  displayChanged,
  saveDisplay,
  savedDisplay,
  subscribeDisplay,
  type Display,
} from "~/features/common/display/utils";
import { effects, startEffects, subscribeEffects, type Effects } from "~/features/common/display/utils/effects";

/** This browser's display choices, and a setter that saves and shows a change to them. */
export function useDisplay(): [Display, (change: Partial<Display>) => void] {
  const display = useSyncExternalStore(subscribeDisplay, savedDisplay, () => DEFAULT_DISPLAY);
  return [display, saveDisplay];
}

/** Picks up choices made in another tab. Use it once, at the root. */
export function useDisplaySync() {
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORE_DISPLAY && e.key !== null) return;
      applyDisplay();
      displayChanged();
    };
    addEventListener("storage", onStorage);
    return () => removeEventListener("storage", onStorage);
  }, []);
}

/** How much to draw: "lite" on a device that can't keep up (see startEffects). */
export function useEffects(): Effects {
  return useSyncExternalStore(subscribeEffects, effects, () => "full");
}

/** Picks the level of effects for this device and times it once the page has settled. Use it once, at the root. */
export function useEffectsCheck() {
  useEffect(() => startEffects(), []);
}
