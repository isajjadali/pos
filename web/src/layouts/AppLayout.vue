<script setup>
import { h, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { NLayout, NLayoutSider, NLayoutContent, NMenu, NButton, NSpace, NText } from "naive-ui";
import {
  HomeOutline,
  CartOutline,
  CubeOutline,
  CloudUploadOutline,
  LayersOutline,
  BarcodeOutline,
  BusinessOutline,
  ReceiptOutline,
  SettingsOutline,
  LogOutOutline,
} from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import { useAuthStore } from "../stores/auth.js";
import { supabaseConfigured } from "../lib/supabase.js";
import { visibleNavItems } from "../config/navigation.js";
import AppHotkeys from "../components/AppHotkeys.vue";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const icon = (component) => () => h(NIcon, null, { default: () => h(component) });

const menuOptions = computed(() =>
  visibleNavItems(auth.isAdmin).map((item) => ({
    label: item.label,
    key: item.key,
    icon: icon(item.icon),
  }))
);

const roleLabel = computed(() => (auth.isAdmin ? "Administrator" : "Sales"));

const activeKey = computed(() => route.name);

function onMenuSelect(key) {
  router.push({ name: key });
}

async function logout() {
  await auth.signOut();
  router.push({ name: "login" });
}
</script>

<template>
  <NLayout has-sider style="min-height: 100vh">
    <NLayoutSider bordered collapse-mode="width" :collapsed-width="64" :width="240" show-trigger>
      <div class="brand">
        <strong class="brand-title">Dollar World</strong>
        <NText depth="2" style="font-size: 12px">by WABz</NText>
      </div>
      <NMenu :value="activeKey" :options="menuOptions" @update:value="onMenuSelect" />
      <div class="sider-footer">
        <NSpace vertical>
          <NText v-if="supabaseConfigured" depth="3" style="font-size: 12px; line-height: 1.35">
            {{ auth.displayName }}
            <br />
            <span class="role-pill">{{ roleLabel }}</span>
          </NText>
          <NText v-if="!supabaseConfigured" depth="3" style="font-size: 12px">
            Demo mode (no Supabase)
          </NText>
          <NButton v-if="supabaseConfigured" quaternary block @click="logout">
            <template #icon><NIcon :component="LogOutOutline" /></template>
            Sign out
          </NButton>
        </NSpace>
      </div>
    </NLayoutSider>
    <NLayoutContent content-style="padding: 24px; background: #f9fafb; min-height: 100vh">
      <div class="shortcut-bar">
        <NText depth="3" style="font-size: 12px">
          <kbd>Shift</kbd> + <kbd>?</kbd> shortcuts · <kbd>Alt</kbd> + <kbd>1</kbd>–<kbd>9</kbd> pages
        </NText>
      </div>
      <RouterView />
      <AppHotkeys />
    </NLayoutContent>
  </NLayout>
</template>

<style scoped>
.brand {
  padding: 20px 16px 12px;
  line-height: 1.3;
  border-bottom: 1px solid #d1d5db;
  margin-bottom: 8px;
}
.brand-title {
  color: var(--app-primary, #0f766e);
  font-size: 1.1rem;
}
.sider-footer {
  position: absolute;
  bottom: 16px;
  left: 16px;
  right: 16px;
}
.shortcut-bar {
  margin: -8px 0 12px;
}
.shortcut-bar kbd {
  display: inline-block;
  padding: 1px 5px;
  font-size: 11px;
  font-family: inherit;
  background: #e5e7eb;
  border: 1px solid #9ca3af;
  border-radius: 4px;
}
.role-pill {
  display: inline-block;
  margin-top: 4px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  color: #0f766e;
  background: #ecfdf5;
  border-radius: 999px;
}
</style>
