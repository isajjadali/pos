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
import ScheduledDiscountsCard from "../components/ScheduledDiscountsCard.vue";
import ReceiptPreview from "../components/ReceiptPreview.vue";
import LabelLayoutPreview from "../components/LabelLayoutPreview.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { getSettings, updateSettings } from "../services/settings.js";
import { useLayoutStore } from "../stores/layout.js";
import { useRoute } from "vue-router";
import { SAMPLE_RECEIPT_ITEMS, SAMPLE_RECEIPT_SALE } from "../utils/receipt.js";
import { printReceipt } from "../utils/receiptPrint.js";

const message = useMessage();
const layout = useLayoutStore();
const route = useRoute();
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
  pos_auto_collapse_sidebar: true,
});
const saving = ref(false);
const settingsLoaded = ref(false);
const savingPosLayout = ref(false);

const labelPreviewName = ref("Non-Stick Spoon");
const labelPreviewBarcode = ref("DW43C441C6A2");
const labelPreviewPrice = ref(250);

async function printSample() {
  try {
    const res = await printReceipt(SAMPLE_RECEIPT_SALE, SAMPLE_RECEIPT_ITEMS, form.value);
    if (res.warning) message.warning(res.warning);
    else message.success(`Sample sent to ${res.printerName || "printer"}`);
  } catch (e) {
    message.error(e.message || "Print failed");
  }
}

async function load() {
  if (!supabaseConfigured) return;
  const s = await getSettings();
  if (s) {
    form.value = {
      ...form.value,
      ...s,
      receipt_show_change: s.receipt_show_change !== false,
      receipt_show_payment: s.receipt_show_payment !== false,
      pos_auto_collapse_sidebar: s.pos_auto_collapse_sidebar !== false,
    };
    layout.setPosAutoCollapseSidebar(form.value.pos_auto_collapse_sidebar);
    layout.applyRouteSidebar(route.name);
  }
  settingsLoaded.value = true;
}

async function savePosLayoutSetting() {
  if (!supabaseConfigured || !settingsLoaded.value) return;
  const on = form.value.pos_auto_collapse_sidebar !== false;
  layout.setPosAutoCollapseSidebar(on);
  layout.applyRouteSidebar(route.name);
  savingPosLayout.value = true;
  try {
    await updateSettings(form.value);
  } catch (e) {
    message.error(e.message || "Could not save layout setting");
  } finally {
    savingPosLayout.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    await updateSettings(form.value);
    layout.setPosAutoCollapseSidebar(form.value.pos_auto_collapse_sidebar !== false);
    layout.applyRouteSidebar(route.name);
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

    <div class="settings-top-row">
      <NCard title="POS & layout" class="settings-top-card">
        <NForm label-placement="top">
          <NFormItem label="Auto-collapse sidebar on POS">
            <NSwitch
              v-model:value="form.pos_auto_collapse_sidebar"
              :loading="savingPosLayout"
              :disabled="!supabaseConfigured || savingPosLayout"
              @update:value="savePosLayoutSetting"
            />
          </NFormItem>
          <NText depth="3" style="font-size: 13px; display: block; margin: -4px 0 12px">
            When enabled, the menu sidebar closes on POS / New Sale and opens again on other pages.
            You can still use the sidebar trigger manually when this is off.
          </NText>
        </NForm>
      </NCard>

      <NCard title="Store" class="settings-top-card">
        <NForm label-placement="top">
          <NFormItem label="Default low-stock threshold">
            <NInputNumber v-model:value="form.default_low_stock_threshold" :min="0" style="width: 100%" />
          </NFormItem>
          <NButton type="primary" :loading="saving" :disabled="!supabaseConfigured" @click="save">
            Save store settings
          </NButton>
        </NForm>
      </NCard>
    </div>

    <ScheduledDiscountsCard class="settings-full-section" />

    <NCard title="Barcode label template">
      <NText depth="3" style="display: block; margin-bottom: 16px; font-size: 13px">
        Left: label size and sample product — right: live preview using the same layout engine as Zebra
        printing (font sizes, wrap, barcode width). Save label size with the button below when done.
      </NText>
      <div class="receipt-split">
        <div class="receipt-fields">
          <NForm label-placement="top">
            <NFormItem label="Label width (mm)">
              <NInputNumber v-model:value="form.label_width_mm" :min="20" style="width: 100%" />
            </NFormItem>
            <NFormItem label="Label height (mm)">
              <NInputNumber v-model:value="form.label_height_mm" :min="15" style="width: 100%" />
            </NFormItem>
            <NFormItem label="Sample product name (preview only)">
              <NInput v-model:value="labelPreviewName" placeholder="Long names wrap like print" />
            </NFormItem>
            <NFormItem label="Sample barcode (preview only)">
              <NInput v-model:value="labelPreviewBarcode" placeholder="Code 128 value on label" />
            </NFormItem>
            <NFormItem label="Sample sale price (preview only)">
              <NInputNumber v-model:value="labelPreviewPrice" :min="0" style="width: 100%" />
            </NFormItem>
          </NForm>
          <NButton type="primary" :loading="saving" :disabled="!supabaseConfigured" @click="save">
            Save label settings
          </NButton>
        </div>
        <div class="receipt-preview-pane label-preview-pane">
          <div class="preview-label">Live preview (Zebra layout)</div>
          <LabelLayoutPreview
            :width-mm="form.label_width_mm"
            :height-mm="form.label_height_mm"
            :name="labelPreviewName"
            :barcode="labelPreviewBarcode"
            :price="labelPreviewPrice"
          />
        </div>
      </div>
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
.settings-top-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  margin-bottom: 20px;
  align-items: stretch;
}

.settings-top-card {
  margin-bottom: 0;
  height: 100%;
}

.settings-full-section {
  display: block;
  width: 100%;
  margin-bottom: 20px;
}

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

.label-preview-pane {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.preview-label {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 8px;
  text-align: center;
}

@media (max-width: 768px) {
  .settings-top-row {
    grid-template-columns: 1fr;
  }

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
