import { ref, onMounted } from "vue";

/**
 * Shared UI online flag — mirrors `navigator.onLine` only.
 * Sticky/cache routing lives in offlineGuard and must NOT flip this
 * (false timeouts were showing "Offline" while the net was fine).
 */
const online = ref(typeof navigator !== "undefined" ? navigator.onLine : true);
let listenersAttached = false;

function sync() {
  online.value = typeof navigator !== "undefined" ? navigator.onLine : true;
}

function ensureListeners() {
  if (listenersAttached || typeof window === "undefined") return;
  listenersAttached = true;
  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
}

/**
 * Reactive `navigator.onLine` for banners / POS / sync UI.
 * Safe to call from multiple components.
 */
export function useOnlineStatus() {
  ensureListeners();
  onMounted(sync);
  return { online };
}

export function getIsOnline() {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

export function onConnectivityChange(handler) {
  if (typeof window === "undefined") return () => {};
  ensureListeners();
  const wrap = () => handler(getIsOnline());
  window.addEventListener("online", wrap);
  window.addEventListener("offline", wrap);
  return () => {
    window.removeEventListener("online", wrap);
    window.removeEventListener("offline", wrap);
  };
}
