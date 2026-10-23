/* App shell precache + Shopify order push/notifications (merged offline POS SW). */
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/shopify-orders";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.postMessage({ type: "shopify-order-click" });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (data.type !== "shopify-order-notify") return;
  const title = data.title || "New Shopify order";
  const body = data.body || "";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/favicon.svg",
      badge: "/favicon.svg",
      tag: data.tag || "shopify-order",
      renotify: true,
      data: { url: data.url || "/shopify-orders" },
    })
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text?.() || "New Shopify order" };
  }
  const title = payload.title || "New Shopify order";
  const body = payload.body || payload.order_name || "You have a new order";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/favicon.svg",
      badge: "/favicon.svg",
      tag: payload.tag || `shopify-order-${payload.shopify_order_id || Date.now()}`,
      renotify: true,
      data: { url: payload.url || "/shopify-orders" },
    })
  );
});
