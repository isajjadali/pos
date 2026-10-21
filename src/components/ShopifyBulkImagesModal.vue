<script setup>
import { ref, computed, watch } from "vue";
import {
  NModal,
  NButton,
  NSpace,
  NText,
  NDataTable,
  NAlert,
  NProgress,
  useMessage,
} from "naive-ui";
import { requireSupabase } from "../lib/supabase.js";
import {
  barcodeFromImageFilename,
  shopifyUploadProductImage,
} from "../services/shopify.js";

const props = defineProps({
  show: { type: Boolean, default: false },
});
const emit = defineEmits(["update:show"]);

const message = useMessage();
const files = ref([]);
const results = ref([]);
const running = ref(false);
const progress = ref({ done: 0, total: 0 });

const showProxy = computed({
  get: () => props.show,
  set: (v) => emit("update:show", v),
});

watch(
  () => props.show,
  (v) => {
    if (v) {
      files.value = [];
      results.value = [];
      progress.value = { done: 0, total: 0 };
    }
  }
);

function onPick(e) {
  const list = Array.from(e.target?.files || []);
  files.value = list;
  results.value = list.map((f) => ({
    filename: f.name,
    barcode: barcodeFromImageFilename(f.name),
    status: "pending",
    notes: "",
  }));
  e.target.value = "";
}

async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function runUpload() {
  if (!files.value.length) {
    message.warning("Select image files named by barcode (e.g. 890123.jpg)");
    return;
  }
  running.value = true;
  progress.value = { done: 0, total: files.value.length };
  const sb = requireSupabase();

  try {
    await mapPool(files.value, 3, async (file, i) => {
      const barcode = barcodeFromImageFilename(file.name);
      const row = results.value[i];
      if (!barcode) {
        row.status = "skipped";
        row.notes = "No barcode in filename";
        progress.value = { ...progress.value, done: progress.value.done + 1 };
        return;
      }
      try {
        let product = null;
        {
          const { data, error } = await sb
            .from("products")
            .select("id, name, shopify_product_id, barcode")
            .eq("barcode", barcode)
            .maybeSingle();
          if (error) throw error;
          product = data;
        }
        if (!product) {
          const { data, error } = await sb
            .from("products")
            .select("id, name, shopify_product_id, barcode")
            .ilike("barcode", barcode)
            .limit(1)
            .maybeSingle();
          if (error) throw error;
          product = data;
        }
        if (!product) {
          row.status = "skipped";
          row.notes = "No local product with this barcode";
          progress.value = { ...progress.value, done: progress.value.done + 1 };
          return;
        }
        await uploadOne(product, file, row);
      } catch (e) {
        row.status = "error";
        row.notes = e.message || String(e);
      }
      progress.value = { ...progress.value, done: progress.value.done + 1 };
    });
    const ok = results.value.filter((r) => r.status === "ok").length;
    const err = results.value.filter((r) => r.status === "error").length;
    const skip = results.value.filter((r) => r.status === "skipped").length;
    message.success(`Images: ${ok} uploaded, ${skip} skipped, ${err} failed`);
  } finally {
    running.value = false;
  }
}

async function uploadOne(product, file, row) {
  row.notes = product.name || product.barcode;
  await shopifyUploadProductImage(product.id, file, { alt: product.name || "" });
  row.status = "ok";
  row.notes = product.name || "Uploaded";
}

const columns = [
  { title: "File", key: "filename", ellipsis: { tooltip: true } },
  { title: "Barcode", key: "barcode", width: 140 },
  { title: "Status", key: "status", width: 90 },
  { title: "Notes", key: "notes", ellipsis: { tooltip: true } },
];
</script>

<template>
  <NModal
    v-model:show="showProxy"
    preset="card"
    title="Upload Shopify images"
    style="width: min(720px, 96vw)"
    :mask-closable="!running"
  >
    <NAlert type="info" style="margin-bottom: 12px">
      Name files by barcode (<code>8901234567890.jpg</code>). Images go to Shopify only — nothing is stored on
      this POS server. Product must already be pushed/linked to Shopify.
    </NAlert>
    <NSpace vertical>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        :disabled="running"
        @change="onPick"
      />
      <NText v-if="files.length" depth="3">{{ files.length }} file(s) selected</NText>
      <NProgress
        v-if="running || progress.total"
        type="line"
        :percentage="progress.total ? Math.round((100 * progress.done) / progress.total) : 0"
        :indicator-placement="'inside'"
      />
      <NDataTable
        v-if="results.length"
        :columns="columns"
        :data="results"
        size="small"
        :bordered="false"
        :max-height="320"
      />
    </NSpace>
    <template #footer>
      <NSpace justify="end">
        <NButton :disabled="running" @click="showProxy = false">Close</NButton>
        <NButton type="primary" :loading="running" :disabled="!files.length" @click="runUpload">
          Upload to Shopify
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>
