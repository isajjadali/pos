import { ref } from "vue";

const helpOpen = ref(false);

export function useShortcutsHelp() {
  return {
    helpOpen,
    openShortcutsHelp: () => {
      helpOpen.value = true;
    },
    closeShortcutsHelp: () => {
      helpOpen.value = false;
    },
  };
}
