/**
 * Saving the dashboard to the home screen as an app: whether it already is, whether the browser can offer to
 * (Chrome and Edge give a prompt we can open), or whether it has to be done by hand (Safari on an iPhone or iPad:
 * Share, then Add to Home Screen). On an iPhone it's also what lets notifications work at all.
 */

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export type InstallState =
  /** Already opened as an app. */
  | "installed"
  /** The browser can show its install prompt: `install()`. */
  | "prompt"
  /** An iPhone or iPad in Safari: by hand. */
  | "ios"
  /** Nothing to offer (a desktop browser without install, or not a secure page). */
  | "none";

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep it for our own button
    deferred = e as InstallEvent;
    changed();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    changed();
  });
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function installState(): InstallState {
  if (isStandalone()) return "installed";
  if (deferred) return "prompt";
  if (isIos()) return "ios";
  return "none";
}

/** Open the browser's install prompt. Whether it was accepted. */
export async function install(): Promise<boolean> {
  if (!deferred) return false;
  const event = deferred;
  deferred = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  changed();
  return outcome === "accepted";
}

const DISMISSED = "wmp:install-dismissed";

export function installDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
}

export function dismissInstall() {
  try {
    localStorage.setItem(DISMISSED, "1");
  } catch {
    /* private mode: it asks again next time */
  }
  changed();
}
