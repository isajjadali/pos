import { ref, onMounted, onUnmounted } from "vue";
import { useLayoutStore } from "../stores/layout.js";

export const MOBILE_BREAKPOINT_PX = 768;

export function useMobileShell() {
  const isMobile = ref(false);
  const layout = useLayoutStore();

  function sync() {
    isMobile.value = window.innerWidth < MOBILE_BREAKPOINT_PX;
  }

  onMounted(() => {
    sync();
    window.addEventListener("resize", sync, { passive: true });
  });

  onUnmounted(() => {
    window.removeEventListener("resize", sync);
  });

  return { isMobile, sync };
}
