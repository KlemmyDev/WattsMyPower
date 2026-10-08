/** localStorage that never throws (private windows, blocked storage). For per-browser conveniences only. */
export const store = {
  get(key: string): string {
    try {
      return localStorage.getItem(key) || "";
    } catch {
      return "";
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* not available */
    }
  },
};

export const STORE_POSTCODE = "wmp-postcode";
export const STORE_BRAND = "wmp-brand";
export const STORE_THEME = "wmp-theme";
export const STORE_DISPLAY = "wmp-display";
export const STORE_IMPORT_WEATHER = "wmp-import-weather";
export const STORE_HOME_RANGE = "wmp-home-range";
export const STORE_HOME_VIEW = "wmp-home-view";
export const STORE_HOME_COMPARE = "wmp-home-compare";
