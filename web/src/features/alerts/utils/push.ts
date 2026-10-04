/**
 * Browser notifications on this device (Web Push): whether this browser can have them, and turning them on and off.
 * The service worker that shows them is web/public/sw.js; the server side is app/features/alerts/webpush.py.
 */

/** Why this browser can't have notifications, or whether it has them. */
export type PushSupport =
  /** Browsers only allow notifications on an https:// page (or localhost). */
  | "insecure"
  /** An iPhone or iPad: only once the dashboard is added to the home screen and opened from there. */
  | "ios-install"
  /** This browser has no Web Push. */
  | "unsupported"
  /** Notifications are blocked for this site in the browser's settings. */
  | "denied"
  | "ready";

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const listeners = new Set<() => void>();

/** Hear when what pushSupport() says may have changed (permission asked for), for useSyncExternalStore. */
export function subscribeSupport(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function pushSupport(): PushSupport {
  if (!window.isSecureContext) return "insecure";
  if (isIos() && !standalone()) return "ios-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
    return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "ready";
}

/** The service worker, registered if it isn't yet. */
export async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

/** This browser's subscription, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  return (await registration()).pushManager.getSubscription();
}

/** The id the server lists a subscription by: the first 16 hex digits of its address's SHA-256 (webpush.device_id). */
export async function deviceId(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Ask for permission and subscribe with the server's key. Throws an Error saying what went wrong. */
export async function subscribe(publicKey: string): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  listeners.forEach((l) => l());
  if (permission !== "granted")
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked for this site. Allow them in your browser's site settings, then try again."
        : "Notifications weren't allowed. Try again, and choose Allow.",
    );
  const reg = await registration();
  const key = keyBytes(publicKey);
  const existing = await reg.pushManager.getSubscription();
  // A subscription made with another key (the server's keys were reset) has to go before a new one can be made.
  if (existing) {
    const same = existing.options.applicationServerKey;
    if (same && new Uint8Array(same).every((b, i) => b === key[i])) return existing;
    await existing.unsubscribe();
  }
  try {
    return await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  } catch (e) {
    throw new Error(
      `This browser couldn't subscribe to notifications${e instanceof Error && e.message ? ` (${e.message})` : ""}.`,
      { cause: e },
    );
  }
}

/** A name to list this browser by: "Chrome on macOS", "Safari on iPhone". */
export function browserName(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "A browser";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  return os ? `${browser} on ${os}` : browser;
}
