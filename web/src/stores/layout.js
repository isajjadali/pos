import { defineStore } from "pinia";
import { ref } from "vue";

const LS_POS_SIDEBAR = "pos_auto_collapse_sidebar";

export const useLayoutStore = defineStore("layout", () => {
  const siderCollapsed = ref(false);
  const posAutoCollapseSidebar = ref(readPosSidebarPref());

  function readPosSidebarPref() {
    try {
      const v = localStorage.getItem(LS_POS_SIDEBAR);
      if (v === "0" || v === "false") return false;
      if (v === "1" || v === "true") return true;
    } catch {
      /* ignore */
    }
    return true;
  }

  function setPosAutoCollapseSidebar(value) {
    const on = Boolean(value);
    posAutoCollapseSidebar.value = on;
    try {
      localStorage.setItem(LS_POS_SIDEBAR, on ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function setSiderCollapsed(value) {
    siderCollapsed.value = Boolean(value);
  }

  /** Apply sidebar state for current route when auto-collapse is enabled. */
  function applyRouteSidebar(routeName) {
    if (!posAutoCollapseSidebar.value) return;
    setSiderCollapsed(routeName === "pos");
  }

  return {
    siderCollapsed,
    posAutoCollapseSidebar,
    setSiderCollapsed,
    setPosAutoCollapseSidebar,
    applyRouteSidebar,
  };
});
