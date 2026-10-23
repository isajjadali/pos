import { requireSupabase } from "../lib/supabase.js";
import { invokeEdgeFunction } from "./edgeFunction.js";

/** Fallback when vite-plugin-pwa has not registered yet (e.g. pure vite dev). */
const FALLBACK_SW_PATH = "/sw-orders.js";

export function notificationPermission() {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export async function ensureOrderServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  let reg = await navigator.serviceWorker.getRegistration("/");
  if (!reg) {
    try {
      reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    } catch {
      reg = await navigator.serviceWorker.register(FALLBACK_SW_PATH, { scope: "/" });
    }
  }
  await navigator.serviceWorker.ready;
  return (await navigator.serviceWorker.getRegistration("/")) || reg;
}

/** Ask OS permission (must be from a user gesture). */
export async function requestDesktopNotifyPermission() {
  if (typeof Notification === "undefined") {
    throw new Error("This browser does not support desktop notifications");
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    throw new Error("Notification permission was not granted");
  }
  await ensureOrderServiceWorker();
  return perm;
}

/**
 * Show a system notification (works when another tab is focused, if POS tab still open).
 * Prefer Service Worker so background tabs still toast.
 */
export async function showOrderDesktopNotification({ title, body, tag, url } = {}) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;

  const payload = {
    type: "shopify-order-notify",
    title: title || "New Shopify order",
    body: body || "",
    tag: tag || "shopify-order",
    url: url || "/shopify-orders",
  };

  try {
    const reg = await ensureOrderServiceWorker();
    if (reg?.showNotification) {
      await reg.showNotification(payload.title, {
        body: payload.body,
        icon: "/favicon.svg",
        badge: "/favicon.svg",
        tag: payload.tag,
        renotify: true,
        data: { url: payload.url },
      });
      return true;
    }
  } catch {
    /* fall through */
  }

  try {
    const n = new Notification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: "/favicon.svg",
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

/** Local test toast (no Shopify order required). */
export async function showTestDesktopNotification() {
  await requestDesktopNotifyPermission();
  return showOrderDesktopNotification({
    title: "Discount World — test",
    body: "Desktop notifications are working.",
    tag: "shopify-order-test",
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Subscribe to Web Push so orders still notify when the browser is closed (needs VAPID secrets). */
export async function subscribeOrderWebPush() {
  await requestDesktopNotifyPermission();
  const sb = requireSupabase();
  const { vapid_public_key: publicKey } = await invokeEdgeFunction(sb, "shopify-sync", {
    action: "push_vapid_public",
  });
  if (!publicKey) {
    throw new Error(
      "Web Push not configured. Set Edge secrets SHOPIFY_VAPID_PUBLIC_KEY + SHOPIFY_VAPID_PRIVATE_KEY (see README)."
    );
  }

  const reg = await ensureOrderServiceWorker();
  if (!reg?.pushManager) throw new Error("Push messaging is not supported in this browser");

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const json = sub.toJSON();
  await invokeEdgeFunction(sb, "shopify-sync", {
    action: "push_subscribe",
    endpoint: json.endpoint,
    keys: json.keys,
  });
  return true;
}
