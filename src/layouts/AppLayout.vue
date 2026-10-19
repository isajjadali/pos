<script setup>
import { h, computed, watch, onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useRoute, useRouter } from "vue-router";
import { useLayoutStore } from "../stores/layout.js";
import SalesPosLayout from "./SalesPosLayout.vue";
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
import { getSettings } from "../services/settings.js";
import AppHotkeys from "../components/AppHotkeys.vue";
import GlobalBarcodeScanner from "../components/GlobalBarcodeScanner.vue";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const layout = useLayoutStore();
const { siderCollapsed } = storeToRefs(layout);

watch(
  () => route.name,
  (name) => {
    layout.applyRouteSidebar(name);
  },
  { immediate: true }
);

onMounted(async () => {
  if (!supabaseConfigured) return;
  try {
    const s = await getSettings();
    if (s && "pos_auto_collapse_sidebar" in s) {
      layout.setPosAutoCollapseSidebar(s.pos_auto_collapse_sidebar !== false);
      layout.applyRouteSidebar(route.name);
    }
  } catch {
    /* keep local default */
  }
});

const icon = (component) => () => h(NIcon, null, { default: () => h(component) });

const menuOptions = computed(() =>
  visibleNavItems(auth.isAdmin).map((item) => ({
    label: item.label,
    key: item.key,
    icon: icon(item.icon),
  }))
);

const roleLabel = computed(() => (auth.isAdmin ? "Administrator" : "Sales"));
const salesOnlyShell = computed(() => supabaseConfigured && auth.isSales);

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
  <SalesPosLayout v-if="salesOnlyShell" />
  <NLayout v-else has-sider style="min-height: 100vh">
    <NLayoutSider
      v-model:collapsed="siderCollapsed"
      bordered
      collapse-mode="width"
      :collapsed-width="64"
      :width="240"
      show-trigger
      class="app-sider"
    >
      <div class="brand" :class="{ 'brand--collapsed': siderCollapsed }">
        <span class="brand-mark">DW</span>
        <strong class="brand-title">Discount World</strong>
        <NText class="brand-sub" depth="2" style="font-size: 12px">by WABz</NText>
      </div>
      <NMenu
        :collapsed="siderCollapsed"
        :collapsed-width="64"
        :collapsed-icon-size="22"
        :value="activeKey"
        :options="menuOptions"
        @update:value="onMenuSelect"
      />
      <div class="sider-footer" :class="{ 'sider-footer--collapsed': siderCollapsed }">
        <NSpace vertical>
          <NText
            v-if="supabaseConfigured && !siderCollapsed"
            depth="3"
            style="font-size: 12px; line-height: 1.35"
          >
            {{ auth.displayName }}
            <br />
            <span class="role-pill">{{ roleLabel }}</span>
          </NText>
          <NText v-if="!supabaseConfigured" depth="3" style="font-size: 12px">
            Demo mode (no Supabase)
          </NText>
          <NButton v-if="supabaseConfigured" quaternary :block="!siderCollapsed" @click="logout">
            <template #icon><NIcon :component="LogOutOutline" /></template>
            <span v-if="!siderCollapsed">Sign out</span>
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
      <GlobalBarcodeScanner />
    </NLayoutContent>
  </NLayout>
</template>

<style scoped>
.app-sider {
  overflow: hidden;
}
.app-sider :deep(.n-menu-item-content) {
  overflow: hidden;
}
.brand {
  padding: 20px 16px 12px;
  line-height: 1.3;
  border-bottom: 1px solid #d1d5db;
  margin-bottom: 8px;
  overflow: hidden;
}
.brand-mark {
  display: none;
  font-size: 1rem;
  font-weight: 800;
  color: var(--app-primary, #0f766e);
}
.brand--collapsed {
  padding: 14px 0 10px;
  text-align: center;
}
.brand--collapsed .brand-title,
.brand--collapsed .brand-sub {
  display: none;
}
.brand--collapsed .brand-mark {
  display: block;
}
.brand-title {
  color: var(--app-primary, #0f766e);
  font-size: 1.1rem;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sider-footer--collapsed {
  left: 8px;
  right: 8px;
  text-align: center;
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
