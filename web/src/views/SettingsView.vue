<script setup>
import { ref, onMounted } from "vue";
import {
  NCard,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NButton,
  NSwitch,
  NText,
  NSpace,
  useMessage,
} from "naive-ui";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import ReceiptPreview from "../components/ReceiptPreview.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { getSettings, updateSettings } from "../services/settings.js";
import {
  SAMPLE_RECEIPT_ITEMS,
  SAMPLE_RECEIPT_SALE,
  openReceiptPrintWindow,
} from "../utils/receipt.js";

function printSample() {
  openReceiptPrintWindow(SAMPLE_RECEIPT_SALE, SAMPLE_RECEIPT_ITEMS, form.value);
}

const message = useMessage();
const form = ref({
  store_name: "Dollar World by WABz",
  default_low_stock_threshold: 5,
  receipt_header: "",
  receipt_footer: "Thank you — visit again!",
  receipt_paper_width: 300,
  receipt_font_size: 13,
  receipt_show_change: true,
  receipt_show_payment: true,
  label_width_mm: 50,
  label_height_mm: 30,
});
const saving = ref(false);

async function load() {
  if (!supabaseConfigured) return;
  const s = await getSettings();
  if (s) {
    form.value = {
      ...form.value,
      ...s,
      receipt_show_change: s.receipt_show_change !== false,
      receipt_show_payment: s.receipt_show_payment !== false,
    };
  }
}

async function save() {
  saving.value = true;
  try {
    await updateSettings(form.value);
    message.success("Settings saved");
  } catch (e) {
    message.error(e.message);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <h1 style="margin-top: 0">Settings</h1>
    <SupabaseRequiredAlert />

    <NCard title="Store & barcode labels" style="max-width: 520px; margin-bottom: 20px">
      <NForm label-placement="top">
        <NFormItem label="Default low-stock threshold">
          <NInputNumber v-model:value="form.default_low_stock_threshold" :min="0" style="width: 100%" />
        </NFormItem>
        <NFormItem label="Label width (mm)">
          <NInputNumber v-model:value="form.label_width_mm" :min="20" style="width: 100%" />
        </NFormItem>
        <NFormItem label="Label height (mm)">
          <NInputNumber v-model:value="form.label_height_mm" :min="15" style="width: 100%" />
        </NFormItem>
      </NForm>
    </NCard>

    <NCard title="Receipt template">
      <NText depth="3" style="display: block; margin-bottom: 16px; font-size: 13px">
        Left: edit fields — right: live preview (same as print). Save when done.
      </NText>

      <div class="receipt-split">
        <div class="receipt-fields">
          <NForm label-placement="top">
            <NFormItem label="Store name (receipt title)">
              <NInput v-model:value="form.store_name" />
            </NFormItem>
            <NFormItem label="Header line (under store name)">
              <NInput v-model:value="form.receipt_header" placeholder="e.g. Main Branch — Karachi" />
            </NFormItem>
            <NFormItem label="Footer message">
              <NInput v-model:value="form.receipt_footer" type="textarea" :rows="4" />
            </NFormItem>
            <NFormItem label="Paper width (px, thermal ~300)">
              <NInputNumber v-model:value="form.receipt_paper_width" :min="240" :max="400" style="width: 100%" />
            </NFormItem>
            <NFormItem label="Font size (px)">
              <NInputNumber v-model:value="form.receipt_font_size" :min="10" :max="18" style="width: 100%" />
            </NFormItem>
            <NFormItem label="Show cash received on receipt">
              <NSwitch v-model:value="form.receipt_show_payment" />
            </NFormItem>
            <NFormItem label="Show change on receipt">
              <NSwitch v-model:value="form.receipt_show_change" />
            </NFormItem>
          </NForm>
          <NSpace>
            <NButton type="primary" :loading="saving" :disabled="!supabaseConfigured" @click="save">
              Save settings
            </NButton>
            <NButton secondary @click="printSample">Print sample</NButton>
          </NSpace>
        </div>

        <div class="receipt-preview-pane">
          <div class="preview-label">Live preview</div>
          <ReceiptPreview :sale="SAMPLE_RECEIPT_SALE" :items="SAMPLE_RECEIPT_ITEMS" :settings="form" />
        </div>
      </div>
    </NCard>
  </div>
</template>

<style scoped>
.receipt-split {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(280px, 1fr);
  gap: 24px;
  align-items: start;
}

.receipt-fields {
  padding-right: 8px;
  border-right: 1px solid #e5e7eb;
}

.receipt-preview-pane {
  position: sticky;
  top: 12px;
}

.preview-label {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 8px;
  text-align: center;
}

@media (max-width: 768px) {
  .receipt-split {
    grid-template-columns: 1fr;
  }
  .receipt-fields {
    border-right: none;
    padding-right: 0;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 20px;
  }
  .receipt-preview-pane {
    position: static;
  }
}
</style>
