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
  NSelect,
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
import { buildLabelZpl } from "../utils/zebraZpl.js";
import { sendZplToZebra } from "../utils/zebraBrowserPrint.js";
import {
  DEFAULT_LABEL_FONT_FAMILY,
  DEFAULT_LABEL_FONT_SIZE,
  DEFAULT_RECEIPT_FONT_FAMILY,
  DEFAULT_RECEIPT_FONT_SIZE,
  DEFAULT_RECEIPT_FOOTER_FONT_SIZE,
  DEFAULT_RECEIPT_TITLE_FONT_SIZE,
  LABEL_FONT_OPTIONS,
  RECEIPT_FONT_OPTIONS,
} from "../config/printFonts.js";
import { SALE_UNIT_OPTIONS, setAppDefaultLabelUnit } from "../utils/saleUnits.js";

const message = useMessage();
const layout = useLayoutStore();
const route = useRoute();
const form = ref({
  store_name: "Discount World by WABz",
  default_low_stock_threshold: 5,
  receipt_header: "",
  receipt_footer: "Thank you — visit again!",
  receipt_paper_width: 300,
  receipt_font_size: DEFAULT_RECEIPT_FONT_SIZE,
  receipt_title_font_size: DEFAULT_RECEIPT_TITLE_FONT_SIZE,
  receipt_footer_font_size: DEFAULT_RECEIPT_FOOTER_FONT_SIZE,
  receipt_font_family: DEFAULT_RECEIPT_FONT_FAMILY,
  receipt_show_change: true,
  receipt_show_payment: true,
  label_width_mm: 50,
  label_height_mm: 30,
  label_font_family: DEFAULT_LABEL_FONT_FAMILY,
  label_font_size: DEFAULT_LABEL_FONT_SIZE,
  label_title_font_size: DEFAULT_LABEL_FONT_SIZE,
  label_name_font_size: DEFAULT_LABEL_FONT_SIZE,
  label_barcode_font_size: DEFAULT_LABEL_FONT_SIZE,
  label_price_font_size: DEFAULT_LABEL_FONT_SIZE,
  pos_auto_collapse_sidebar: true,
  default_label_unit: "pack",
});

const labelUnitOptions = SALE_UNIT_OPTIONS;
const receiptFontSelectOptions = RECEIPT_FONT_OPTIONS.map((o) => ({
  label: o.label,
  value: o.value,
}));
const labelFontSelectOptions = LABEL_FONT_OPTIONS.map((o) => ({
  label: o.label,
  value: o.value,
}));
const saving = ref(false);
const settingsLoaded = ref(false);
const savingPosLayout = ref(false);
const printingLabelSample = ref(false);

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

async function printLabelSample() {
  printingLabelSample.value = true;
  try {
    const f = form.value;
    const zpl = buildLabelZpl(
      {
        name: labelPreviewName.value,
        barcode: labelPreviewBarcode.value,
        price: labelPreviewPrice.value,
      },
      Number(f.label_width_mm) || 50,
      Number(f.label_height_mm) || 30,
      undefined,
      {
        fontFamily: f.label_font_family,
        titleSize: f.label_title_font_size,
        nameSize: f.label_name_font_size,
        barcodeSize: f.label_barcode_font_size,
        priceSize: f.label_price_font_size,
      }
    );
    const result = await sendZplToZebra(zpl);
    message.success(`Sample label sent to ${result.printerName || "Zebra"}`);
  } catch (e) {
    message.error(e.message || "Label print failed");
  } finally {
    printingLabelSample.value = false;
  }
}

async function load() {
  if (!supabaseConfigured) return;
  const s = await getSettings();
  if (s) {
    const legacyLabel = Number(s.label_font_size) || DEFAULT_LABEL_FONT_SIZE;
    form.value = {
      ...form.value,
      ...s,
      receipt_font_family: s.receipt_font_family || DEFAULT_RECEIPT_FONT_FAMILY,
      receipt_font_size: Number(s.receipt_font_size) || DEFAULT_RECEIPT_FONT_SIZE,
      receipt_title_font_size:
        Number(s.receipt_title_font_size) || DEFAULT_RECEIPT_TITLE_FONT_SIZE,
      receipt_footer_font_size:
        Number(s.receipt_footer_font_size) || DEFAULT_RECEIPT_FOOTER_FONT_SIZE,
      label_font_family: s.label_font_family || DEFAULT_LABEL_FONT_FAMILY,
      label_font_size: legacyLabel,
      label_title_font_size: Number(s.label_title_font_size) || legacyLabel,
      label_name_font_size: Number(s.label_name_font_size) || legacyLabel,
      label_barcode_font_size: Number(s.label_barcode_font_size) || legacyLabel,
      label_price_font_size: Number(s.label_price_font_size) || legacyLabel,
      receipt_show_change: s.receipt_show_change !== false,
      receipt_show_payment: s.receipt_show_payment !== false,
      pos_auto_collapse_sidebar: s.pos_auto_collapse_sidebar !== false,
      default_label_unit: s.default_label_unit || "pack",
    };
    setAppDefaultLabelUnit(form.value.default_label_unit);
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
  setAppDefaultLabelUnit(form.value.default_label_unit);
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
    setAppDefaultLabelUnit(form.value.default_label_unit);
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
  <div class="settings-page">
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
          <NText depth="3" style="font-size: 13px; display: block; margin: -4px 0 0">
            Sidebar closes on POS / New Sale and opens again on other pages.
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

      <NCard title="Default label unit" class="settings-top-card">
        <NForm label-placement="top">
          <NFormItem label="Piece / Pack / Box">
            <NSelect
              v-model:value="form.default_label_unit"
              :options="labelUnitOptions"
              :disabled="!supabaseConfigured || savingPosLayout"
              style="width: 100%"
              @update:value="savePosLayoutSetting"
            />
          </NFormItem>
          <NText depth="3" style="font-size: 13px; display: block; margin: -4px 0 0">
            Default for POS, barcode labels, and price groups. Falls back if unit is missing.
          </NText>
        </NForm>
      </NCard>
    </div>

    <ScheduledDiscountsCard class="settings-full-section" />

    <NCard title="Barcode label template">
      <NText depth="3" style="display: block; margin-bottom: 16px; font-size: 13px">
        Left: size &amp; fonts — right: live Zebra preview. Section sizes at 100% match the previous auto
        layout. Save when done.
      </NText>
      <div class="receipt-split">
        <div class="receipt-fields">
          <NForm label-placement="top" class="form-grid-2">
            <NFormItem label="Label width (mm)">
              <NInputNumber v-model:value="form.label_width_mm" :min="20" style="width: 100%" />
            </NFormItem>
            <NFormItem label="Label height (mm)">
              <NInputNumber v-model:value="form.label_height_mm" :min="15" style="width: 100%" />
            </NFormItem>
            <NFormItem label="Font type" class="span-2">
              <NSelect
                v-model:value="form.label_font_family"
                :options="labelFontSelectOptions"
                style="width: 100%"
              />
            </NFormItem>
            <NFormItem label="Title size % (Discount World…)">
              <NInputNumber
                v-model:value="form.label_title_font_size"
                :min="70"
                :max="140"
                :step="5"
                style="width: 100%"
              />
            </NFormItem>
            <NFormItem label="Product name size %">
              <NInputNumber
                v-model:value="form.label_name_font_size"
                :min="70"
                :max="140"
                :step="5"
                style="width: 100%"
              />
            </NFormItem>
            <NFormItem label="Barcode text size %">
              <NInputNumber
                v-model:value="form.label_barcode_font_size"
                :min="70"
                :max="140"
                :step="5"
                style="width: 100%"
              />
            </NFormItem>
            <NFormItem label="Price size %">
              <NInputNumber
                v-model:value="form.label_price_font_size"
                :min="70"
                :max="140"
                :step="5"
                style="width: 100%"
              />
            </NFormItem>
            <NFormItem label="Sample product name (preview)" class="span-2">
              <NInput v-model:value="labelPreviewName" placeholder="Long names wrap like print" />
            </NFormItem>
            <NFormItem label="Sample barcode (preview)">
              <NInput v-model:value="labelPreviewBarcode" placeholder="Code 128 value on label" />
            </NFormItem>
            <NFormItem label="Sample sale price (preview)">
              <NInputNumber v-model:value="labelPreviewPrice" :min="0" style="width: 100%" />
            </NFormItem>
          </NForm>
          <NSpace class="settings-actions" wrap>
            <NButton type="primary" :loading="saving" :disabled="!supabaseConfigured" @click="save">
              Save label settings
            </NButton>
            <NButton secondary :loading="printingLabelSample" @click="printLabelSample">
              Print sample
            </NButton>
          </NSpace>
        </div>
        <div class="receipt-preview-pane label-preview-pane">
          <div class="preview-label">Live preview (Zebra layout)</div>
          <LabelLayoutPreview
            :width-mm="form.label_width_mm"
            :height-mm="form.label_height_mm"
            :name="labelPreviewName"
            :barcode="labelPreviewBarcode"
            :price="labelPreviewPrice"
            :font-family="form.label_font_family"
            :title-font-size="form.label_title_font_size"
            :name-font-size="form.label_name_font_size"
            :barcode-font-size="form.label_barcode_font_size"
            :price-font-size="form.label_price_font_size"
          />
        </div>
      </div>
    </NCard>

    <NCard title="Receipt template">
      <NText depth="3" style="display: block; margin-bottom: 16px; font-size: 13px">
        Left: edit fields — right: live preview (same as print). Defaults match the previous look (title
        17 / body 13 / footer 12). Save when done.
      </NText>

      <div class="receipt-split">
        <div class="receipt-fields">
          <NForm label-placement="top" class="form-grid-2">
            <NFormItem label="Store name (receipt title)" class="span-2">
              <NInput v-model:value="form.store_name" />
            </NFormItem>
            <NFormItem label="Header line (under store name)" class="span-2">
              <NInput v-model:value="form.receipt_header" placeholder="e.g. Main Branch — Karachi" />
            </NFormItem>
            <NFormItem label="Footer message" class="span-2">
              <NInput v-model:value="form.receipt_footer" type="textarea" :rows="3" />
            </NFormItem>
            <NFormItem label="Paper width (px)">
              <NInputNumber
                v-model:value="form.receipt_paper_width"
                :min="240"
                :max="400"
                style="width: 100%"
              />
            </NFormItem>
            <NFormItem label="Font type">
              <NSelect
                v-model:value="form.receipt_font_family"
                :options="receiptFontSelectOptions"
                style="width: 100%"
              />
            </NFormItem>
            <NFormItem label="Title font size (px)">
              <NInputNumber
                v-model:value="form.receipt_title_font_size"
                :min="10"
                :max="28"
                style="width: 100%"
              />
            </NFormItem>
            <NFormItem label="Content font size (px)">
              <NInputNumber
                v-model:value="form.receipt_font_size"
                :min="10"
                :max="18"
                style="width: 100%"
              />
            </NFormItem>
            <NFormItem label="Footer font size (px)">
              <NInputNumber
                v-model:value="form.receipt_footer_font_size"
                :min="8"
                :max="18"
                style="width: 100%"
              />
            </NFormItem>
            <NFormItem label="Show cash received">
              <NSwitch v-model:value="form.receipt_show_payment" />
            </NFormItem>
            <NFormItem label="Show change">
              <NSwitch v-model:value="form.receipt_show_change" />
            </NFormItem>
          </NForm>
          <NSpace class="settings-actions" wrap>
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
.settings-page {
  width: 100%;
  max-width: 100%;
}

.settings-page :deep(.n-card) {
  width: 100%;
  max-width: 100%;
  margin-bottom: 20px;
}

.settings-top-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
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

.form-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 12px;
  row-gap: 0;
}

.form-grid-2 :deep(.n-form-item) {
  grid-column: span 1;
  margin-bottom: 12px;
}

.form-grid-2 :deep(.span-2),
.form-grid-2 :deep(.n-form-item.span-2) {
  grid-column: 1 / -1;
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

@media (max-width: 900px) {
  .receipt-split {
    grid-template-columns: 1fr;
  }
  .receipt-fields {
    border-right: none;
    padding-right: 0;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 20px;
    margin-bottom: 8px;
  }
  .receipt-preview-pane {
    position: static;
    width: 100%;
    max-width: 100%;
    overflow-x: auto;
  }
  .label-preview-pane {
    align-items: stretch;
    overflow-x: hidden;
  }
}

@media (max-width: 960px) {
  .settings-top-row {
    grid-template-columns: 1fr;
    gap: 12px;
    margin-bottom: 12px;
  }
}

@media (max-width: 768px) {
  .form-grid-2 {
    grid-template-columns: 1fr;
  }

  .settings-full-section {
    margin-bottom: 12px;
  }

  .settings-actions {
    width: 100%;
  }

  .settings-actions :deep(.n-button) {
    flex: 1 1 auto;
    min-width: 0;
  }
}
</style>
