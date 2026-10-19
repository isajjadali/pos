<script setup>
import { onMounted, onUnmounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useMessage } from "naive-ui";
import { attachBarcodeWedgeListener } from "../utils/barcodeWedge.js";
import { findProductByCodeCached } from "../services/productCatalog.js";
import { findProductByBarcode } from "../services/pos.js";
import { usePosCartStore } from "../stores/posCart.js";
import { supabaseConfigured } from "../lib/supabase.js";

const router = useRouter();
const route = useRoute();
const message = useMessage();
const cartStore = usePosCartStore();

let detach = null;

async function lookupProduct(code) {
  const cached = findProductByCodeCached(code);
  if (cached) return cached;
  if (!supabaseConfigured) return null;
  return findProductByBarcode(code);
}

async function onScan(code) {
  const product = await lookupProduct(code);
  if (!product) {
    message.warning(`No product for barcode: ${code}`);
    return;
  }

  cartStore.ensureActiveCart();
  cartStore.addProduct(product, 1);

  if (route.name !== "pos") {
    await router.push({ name: "pos" });
  }
}

onMounted(() => {
  detach = attachBarcodeWedgeListener(onScan, {
    enabled: () => route.name !== "login",
  });
});

onUnmounted(() => {
  detach?.();
});
</script>

<template>
  <!-- Global HID barcode scanner listener (no UI) -->
</template>
