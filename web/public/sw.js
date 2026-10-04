/*
 * WattsMyPower's service worker: shows alerts as the browser's own notifications (Settings → Alerts → This
 * browser). It does nothing else: no caching, no offline pages. Each push is decrypted by the browser and arrives
 * as JSON from app/features/alerts/webpush.py: { title, body, tag, event, url, urgent, ts }.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "WattsMyPower";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      // A newer notification from the same alert replaces the old one rather than piling up.
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      timestamp: data.ts ? data.ts * 1000 : Date.now(),
      // An urgent one (the inverter not answering) stays until it's dismissed.
      requireInteraction: Boolean(data.urgent),
      data: { url: data.url || "/" },
    }),
  );
});

// A tap opens the page the alert is about, in an open dashboard tab if there is one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        return open.navigate ? open.navigate(url) : undefined;
      }
      return self.clients.openWindow(url);
    }),
  );
});

// The push service replaced the subscription (it expired, or the browser renewed its keys): subscribe again with
// the server's key and tell the server, so alerts keep arriving.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const res = await fetch("/api/alerts/push", { credentials: "same-origin" });
      if (!res.ok) return;
      const { public_key: key } = await res.json();
      const raw = atob(key.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (key.length % 4)) % 4));
      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)),
      });
      await fetch("/api/alerts/push/devices", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON(), name: "This browser (renewed)" }),
      });
    })(),
  );
});
