<script setup>
import { h, computed, watch, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { useRoute, useRouter } from "vue-router";
import { useLayoutStore } from "../stores/layout.js";
import SalesPosLayout from "./SalesPosLayout.vue";
import { NLayout, NLayoutSider, NLayoutContent, NMenu, NButton, NText } from "naive-ui";
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
import {
  visibleNavItems,
  findNavLeaf,
  expandedNavKeysForRoute,
} from "../config/navigation.js";
import { getSettings } from "../services/settings.js";
import AppHotkeys from "../components/AppHotkeys.vue";
import GlobalBarcodeScanner from "../components/GlobalBarcodeScanner.vue";
import ShopifyOrderBell from "../components/ShopifyOrderBell.vue";
import { useMobileShell } from "../composables/useMobileShell.js";
import { FEATURE_SHOPIFY } from "../config/features.js";

const shopifyEnabled = FEATURE_SHOPIFY;

const route = useRoute();
const { isMobile } = useMobileShell();
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

function toMenuOption(item) {
  const opt = {
    label: item.label,
    key: item.key,
    icon: icon(item.icon),
  };
  if (item.children?.length) {
    opt.children = item.children.map(toMenuOption);
  }
  return opt;
}

const menuOptions = computed(() => visibleNavItems(auth.isAdmin).map(toMenuOption));

const menuExpandedKeys = ref([]);

watch(
  () => [auth.isAdmin, route.name],
  () => {
    const needed = expandedNavKeysForRoute(auth.isAdmin, route.name);
    if (!needed.length) return;
    const set = new Set(menuExpandedKeys.value);
    for (const k of needed) set.add(k);
    menuExpandedKeys.value = [...set];
  },
  { immediate: true }
);

const roleLabel = computed(() => (auth.isAdmin ? "Administrator" : "Sales"));
const salesOnlyShell = computed(() => supabaseConfigured && auth.isSales);

const activeKey = computed(() => route.name);

function onMenuSelect(key) {
  // Parent group keys are not routes — ignore
  if (String(key).startsWith("nav-")) return;
  router.push({ name: key });
}

function onMenuExpandedKeys(keys) {
  menuExpandedKeys.value = keys;
}

async function logout() {
  await auth.signOut();
  router.push({ name: "login" });
}

const contentStyle = computed(() => ({
  padding: isMobile.value ? "12px" : "24px",
  background: "#f9fafb",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  boxSizing: "border-box",
}));

const mobileNavOpen = ref(false);

function toggleMobileNav() {
  mobileNavOpen.value = !mobileNavOpen.value;
}

function closeMobileNav() {
  mobileNavOpen.value = false;
}

watch(
  () => route.name,
  () => {
    closeMobileNav();
  }
);

watch(isMobile, (mobile, wasMobile) => {
  // Only close drawer when actually crossing into mobile — avoid focus/resize flicker
  if (mobile && wasMobile === false) closeMobileNav();
});

const siderCollapsedBinding = computed({
  get() {
    if (isMobile.value) return !mobileNavOpen.value;
    return siderCollapsed.value;
  },
  set(collapsed) {
    if (isMobile.value) {
      mobileNavOpen.value = !collapsed;
    } else {
      layout.setSiderCollapsed(collapsed);
    }
  },
});

const siderCollapsedWidth = computed(() => (isMobile.value ? 0 : 64));

const menuCollapsed = computed(() => {
  if (isMobile.value) return !mobileNavOpen.value;
  return siderCollapsed.value;
});

const mobilePageTitle = computed(() => {
  const item = findNavLeaf(auth.isAdmin, route.name);
  return item?.label ?? "Discount World";
});
</script>

<template>
  <SalesPosLayout v-if="salesOnlyShell" />
  <NLayout v-else has-sider class="app-shell" style="min-height: 100vh">
    <div
      v-if="isMobile && mobileNavOpen"
      class="app-sider-backdrop"
      aria-hidden="true"
      @click="closeMobileNav"
    />
    <NLayoutSider
      v-model:collapsed="siderCollapsedBinding"
      bordered
      collapse-mode="width"
      :collapsed-width="siderCollapsedWidth"
      :width="240"
      :show-trigger="!isMobile"
      class="app-sider"
      :class="{ 'app-sider--drawer': isMobile && mobileNavOpen }"
    >
      <div class="sider-inner">
        <div
          class="brand"
          :class="{ 'brand--collapsed': siderCollapsed && !isMobile, 'brand--tap': isMobile }"
          @click="isMobile ? toggleMobileNav() : undefined"
        >
          <span class="brand-mark">DW</span>
          <strong class="brand-title">Discount World</strong>
          <NText class="brand-sub" depth="2" style="font-size: 12px">by WABz</NText>
        </div>
        <div class="sider-menu-wrap">
          <NMenu
            :collapsed="menuCollapsed"
            :collapsed-width="64"
            :collapsed-icon-size="22"
            :value="activeKey"
            :options="menuOptions"
            :expanded-keys="menuExpandedKeys"
            @update:value="onMenuSelect"
            @update:expanded-keys="onMenuExpandedKeys"
          />
        </div>
        <div class="sider-footer" :class="{ 'sider-footer--collapsed': menuCollapsed }">
          <div v-if="supabaseConfigured && !menuCollapsed" class="sider-user">
            <span class="sider-user-name">{{ auth.displayName }}</span>
            <span class="role-pill">{{ roleLabel }}</span>
          </div>
          <NText v-if="!supabaseConfigured" depth="3" style="font-size: 12px">
            Demo mode (no Supabase)
          </NText>
          <NButton v-if="supabaseConfigured" quaternary :block="!menuCollapsed" @click="logout">
            <template #icon><NIcon :component="LogOutOutline" /></template>
            <span v-if="!menuCollapsed">Sign out</span>
          </NButton>
        </div>
      </div>
    </NLayoutSider>
    <NLayoutContent class="app-content" :content-style="contentStyle">
      <header v-if="isMobile" class="app-mobile-bar">
        <button type="button" class="app-mobile-dw" aria-label="Open menu" @click="toggleMobileNav">
          DW
        </button>
        <span class="app-mobile-bar-title">{{ mobilePageTitle }}</span>
      </header>
      <div v-show="!isMobile" class="shortcut-bar">
        <NText depth="3" style="font-size: 12px">
          <kbd>Shift</kbd> + <kbd>?</kbd> shortcuts · <kbd>Alt</kbd> + <kbd>1</kbd>–<kbd>9</kbd> pages
        </NText>
        <ShopifyOrderBell v-if="shopifyEnabled" />
      </div>
      <div v-if="isMobile && shopifyEnabled" class="app-mobile-bell">
        <ShopifyOrderBell />
      </div>
      <div class="app-page">
        <RouterView />
      </div>
      <AppHotkeys />
      <GlobalBarcodeScanner />
    </NLayoutContent>
  </NLayout>
</template>

<style scoped>
.app-sider {
  overflow: hidden;
}
.app-sider :deep(.n-layout-sider-scroll-container) {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.app-sider :deep(.n-menu-item-content) {
  overflow: hidden;
}
.sider-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.sider-menu-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.brand {
  flex-shrink: 0;
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
.sider-footer {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 12px 16px 16px;
  border-top: 1px solid #e5e7eb;
}
.sider-footer--collapsed {
  padding: 12px 8px 16px;
  align-items: center;
}
.sider-user {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  font-size: 12px;
  line-height: 1.35;
  color: #9ca3af;
}
.sider-user-name {
  color: inherit;
}
.shortcut-bar {
  flex: 0 0 auto;
  margin: -8px 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.app-mobile-bell {
  display: flex;
  justify-content: flex-end;
  margin: -4px 0 8px;
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
.app-mobile-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: -4px 0 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #e5e7eb;
}
.app-mobile-dw {
  border: none;
  background: #ecfdf5;
  color: #0f766e;
  font-size: 0.95rem;
  font-weight: 800;
  padding: 8px 14px;
  border-radius: 8px;
  cursor: pointer;
  line-height: 1;
}
.app-mobile-dw:active {
  background: #d1fae5;
}
.app-mobile-bar-title {
  font-size: 14px;
  font-weight: 600;
  color: #374151;
}
.app-sider-backdrop {
  position: fixed;
  inset: 0;
  z-index: 199;
  background: rgba(15, 23, 42, 0.45);
}
.brand--tap {
  cursor: pointer;
}
@media (max-width: 768px) {
  .app-sider--drawer {
    position: fixed !important;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 200;
    height: 100vh !important;
    max-height: 100vh;
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.18);
  }
  .app-sider :deep(.n-layout-toggle-button) {
    display: none !important;
  }
}
</style>
