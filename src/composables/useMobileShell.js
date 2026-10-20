import { ref, onMounted, onUnmounted } from "vue";

export const MOBILE_BREAKPOINT_PX = 768;

function readIsMobile() {
  if (typeof window === "undefined") return false;
  return window.innerWidth < MOBILE_BREAKPOINT_PX;
}

export function useMobileShell() {
  // Init from current width immediately so sidebar doesn't flash desktop→mobile
  const isMobile = ref(readIsMobile());
  let resizeTimer = null;

  function sync() {
    // Ignore resize noise while tab is in background (common on Windows focus switch)
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }
    const next = readIsMobile();
    if (next !== isMobile.value) {
      isMobile.value = next;
    }
  }

  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(sync, 150);
  }

  onMounted(() => {
    sync();
    window.addEventListener("resize", onResize, { passive: true });
  });

  onUnmounted(() => {
    if (resizeTimer) clearTimeout(resizeTimer);
    window.removeEventListener("resize", onResize);
  });

  return { isMobile, sync };
}
