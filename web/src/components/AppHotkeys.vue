<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import KeyboardShortcutsModal from "./KeyboardShortcutsModal.vue";
import { useAuthStore } from "../stores/auth.js";
import { navRouteKeysForUser } from "../config/navigation.js";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const helpOpen = ref(false);

function onKeyDown(e) {
  if (e.key === "?" && e.shiftKey) {
    e.preventDefault();
    helpOpen.value = true;
    return;
  }

  if (e.altKey && /^[1-9]$/.test(e.key)) {
    e.preventDefault();
    const routes = navRouteKeysForUser(auth.isAdmin);
    const name = routes[Number(e.key) - 1];
    if (name && route.name !== "login") router.push({ name });
    return;
  }

  if (e.key === "Escape" && helpOpen.value) {
    helpOpen.value = false;
  }
}

onMounted(() => window.addEventListener("keydown", onKeyDown));
onUnmounted(() => window.removeEventListener("keydown", onKeyDown));
</script>

<template>
  <KeyboardShortcutsModal v-model:show="helpOpen" />
</template>
