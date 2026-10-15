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

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const icon = (component) => () => h(NIcon, null, { default: () => h(component) });

const menuOptions = [
  { label: "Dashboard", key: "dashboard", icon: icon(HomeOutline) },
  { label: "POS / New Sale", key: "pos", icon: icon(CartOutline) },
  { label: "Products", key: "products", icon: icon(CubeOutline) },
  { label: "Import Products", key: "import", icon: icon(CloudUploadOutline) },
  { label: "Inventory", key: "inventory", icon: icon(LayersOutline) },
  { label: "Barcode Printing", key: "barcodes", icon: icon(BarcodeOutline) },
  { label: "Vendors", key: "vendors", icon: icon(BusinessOutline) },
  { label: "Sales History", key: "sales", icon: icon(ReceiptOutline) },
  { label: "Settings", key: "settings", icon: icon(SettingsOutline) },
];

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
        <strong>Dollar World</strong>
        <NText depth="3" style="font-size: 12px">by WABz</NText>
      </div>
      <NMenu :value="activeKey" :options="menuOptions" @update:value="onMenuSelect" />
      <div class="sider-footer">
        <NSpace vertical>
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
    <NLayoutContent content-style="padding: 24px">
      <RouterView />
    </NLayoutContent>
  </NLayout>
</template>

<style scoped>
.brand {
  padding: 20px 16px 12px;
  line-height: 1.3;
}
.sider-footer {
  position: absolute;
  bottom: 16px;
  left: 16px;
  right: 16px;
}
</style>
