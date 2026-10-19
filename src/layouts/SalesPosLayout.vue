<script setup>
import { useRouter } from "vue-router";
import { NButton, NText } from "naive-ui";
import { useAuthStore } from "../stores/auth.js";
import { supabaseConfigured } from "../lib/supabase.js";
import GlobalBarcodeScanner from "../components/GlobalBarcodeScanner.vue";
import AppHotkeys from "../components/AppHotkeys.vue";

const router = useRouter();
const auth = useAuthStore();

async function logout() {
  await auth.signOut();
  router.push({ name: "login" });
}
</script>

<template>
  <div class="sales-shell">
    <header class="sales-topbar">
      <div class="sales-brand">
        <strong>Discount World</strong>
        <NText depth="3" style="font-size: 12px">by WABz · New sale</NText>
      </div>
      <NButton v-if="supabaseConfigured" type="primary" ghost @click="logout">Sign out</NButton>
    </header>
    <main class="sales-main">
      <RouterView />
      <GlobalBarcodeScanner />
      <AppHotkeys />
    </main>
  </div>
</template>

<style scoped>
.sales-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f9fafb;
}
.sales-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 20px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.sales-brand {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.sales-brand strong {
  color: var(--app-primary, #0f766e);
  font-size: 1.15rem;
}
.sales-main {
  flex: 1;
  padding: 20px 24px 32px;
  max-width: 1280px;
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
}
</style>
