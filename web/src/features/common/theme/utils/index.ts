import { store, STORE_THEME } from "~/features/common/storage/utils";

/*
 * Light or dark, chosen per browser in Settings → Account. "System" follows the device's setting.
 * The page shows a theme through <html data-theme>, which swaps the colour tokens in styles/app.css.
 */

export type ThemeChoice = "system" | "light" | "dark";
type Theme = "light" | "dark";

/** What a browser gets until someone picks: dark, as the dashboard always was. */
const DEFAULT: ThemeChoice = "dark";
export const LIGHT_QUERY = "(prefers-color-scheme: light)";
/** The browser's own UI colour (address bar, installed app title bar): each theme's canvas. */
const THEME_COLOR: Record<Theme, string> = { dark: "#0a0a0a", light: "#f4f4f5" };

export const THEME_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** This browser's choice. */
export function savedTheme(): ThemeChoice {
  const v = store.get(STORE_THEME);
  return v === "system" || v === "light" || v === "dark" ? v : DEFAULT;
}

const resolve = (choice: ThemeChoice): Theme =>
  choice === "system" ? (matchMedia(LIGHT_QUERY).matches ? "light" : "dark") : choice;

function setMeta(name: string, content: string) {
  let meta = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = name;
    document.head.append(meta);
  }
  meta.content = content;
}

/** Show the page in a choice's theme, with matching color-scheme and theme-color meta tags. */
export function applyTheme(choice: ThemeChoice = savedTheme()) {
  const theme = resolve(choice);
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  // Switch in one go: without this, anything with a colour transition fades over while the rest snaps.
  const still = document.createElement("style");
  still.textContent = "*, *::before, *::after { transition: none !important; }";
  document.head.append(still);
  root.dataset.theme = theme;
  setMeta("color-scheme", theme);
  setMeta("theme-color", THEME_COLOR[theme]);
  void getComputedStyle(root).color; // apply the new colours while transitions are off
  setTimeout(() => still.remove());
}

const listeners = new Set<() => void>();

/** Hear about choices saved here or in another tab (for useSyncExternalStore). */
export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const themeChanged = () => listeners.forEach((l) => l());

/** Save a choice for this browser and show it. */
export function saveTheme(choice: ThemeChoice) {
  store.set(STORE_THEME, choice);
  applyTheme(choice);
  themeChanged();
}

/**
 * applyTheme for the document head (routes/__root.tsx), so the saved theme is in place before the
 * first paint. It runs before React and the app's modules, so it repeats the logic: keep the two in step.
 */
export const THEME_SCRIPT = `(() => {
  let choice = "${DEFAULT}";
  try {
    choice = localStorage.getItem("${STORE_THEME}") || choice;
  } catch {}
  const theme = choice === "light" || (choice === "system" && matchMedia("${LIGHT_QUERY}").matches) ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  for (const [name, content] of [["color-scheme", theme], ["theme-color", theme === "light" ? "${THEME_COLOR.light}" : "${THEME_COLOR.dark}"]]) {
    const meta = document.createElement("meta");
    meta.name = name;
    meta.content = content;
    document.head.append(meta);
  }
})();`;
