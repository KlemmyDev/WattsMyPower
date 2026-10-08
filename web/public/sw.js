/*
 * WattsMyPower no longer sends browser notifications (alerts were taken out). A browser that turned them on still
 * has the old service worker: this one replaces it at its next update check, then unregisters itself and drops the
 * push subscription it held.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      const sub = await self.registration.pushManager.getSubscription().catch(() => null);
      await sub?.unsubscribe().catch(() => {});
      await self.registration.unregister();
    })(),
  ),
);
