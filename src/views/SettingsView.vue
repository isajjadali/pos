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
import BarcodePrintSheet from "../components/BarcodePrintSheet.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { getSettings, updateSettings } from "../services/settings.js";
import { createBrowserPrintSession } from "../utils/browserLabelPrint.js";
import {
  shopifyTestConnection,
  shopifyPushAll,
  shopifyPullStock,
  shopifyRegisterWebhooks,
} from "../services/shopify.js";
import { useLayoutStore } from "../stores/layout.js";
import { useRoute } from "vue-router";
import { SAMPLE_RECEIPT_ITEMS, SAMPLE_RECEIPT_SALE } from "../utils/receipt.js";
import { printReceipt } from "../utils/receiptPrint.js";
import { buildLabelZpl } from "../utils/zebraZpl.js";
import {
  sendZplToZebra,
  resolveBrowserPrintBaseForUi,
  getPreferredLabelPrinter,
  setPreferredLabelPrinter,
} from "../utils/zebraBrowserPrint.js";
import { listPrintStations, stationIsOnline } from "../services/zplPrintQueue.js";
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
import { FEATURE_SHOPIFY } from "../config/features.js";

const shopifyFeatureOn = FEATURE_SHOPIFY;
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
  shopify_enabled: false,
  shopify_shop_domain: "",
  shopify_location_id: null,
});

const shopifyLocationOptions = ref([]);
const shopifyBusy = ref(false);
const shopifyTesting = ref(false);
const shopifyProgress = ref("");

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
const browserPrintJob = ref(null);
let browserPrintSession = null;
const bridgeChecking = ref(false);
const bridgeStatus = ref({
  ok: false,
  message: "Not checked yet",
  printerName: "",
  zebraPrinters: [],
  host: "",
});
const shopStations = ref([]);
const selectedLabelPrinter = ref(getPreferredLabelPrinter() || null);

const labelPreviewName = ref("Non-Stick Spoon");
const labelPreviewBarcode = ref("DW270C43C441C6A2");
const labelPreviewPrice = ref(250);

async function refreshPrinterBridge() {
  bridgeChecking.value = true;
  try {
    try {
      shopStations.value = await listPrintStations();
    } catch {
      shopStations.value = [];
    }
    const info = await resolveBrowserPrintBaseForUi();
    if (!info.ok) {
      const online = shopStations.value.find((s) => stationIsOnline(s));
      bridgeStatus.value = {
        ok: false,
        message: online
          ? `Local bridge offline — cloud agent online (${online.name || online.host_name})`
          : info.message ||
            "Bridge offline. Shop PC pe scripts/start-printer-bridge.bat chalao (Startup pe rakh sakte ho).",
        printerName: online?.printer_name || "",
        zebraPrinters: [],
        host: online?.host_name || "",
        agentOnline: Boolean(online),
      };
      return;
    }
    bridgeStatus.value = {
      ok: true,
      message: "Local bridge online on this PC",
      printerName: info.printerName || "",
      zebraPrinters: info.zebraPrinters || [],
      host: info.host || "",
      agentOnline: shopStations.value.some((s) => stationIsOnline(s)),
    };
    if (!selectedLabelPrinter.value && info.printerName) {
      selectedLabelPrinter.value = info.printerName;
    }
  } finally {
    bridgeChecking.value = false;
  }
}

function saveLabelPrinterChoice(name) {
  selectedLabelPrinter.value = name || null;
  setPreferredLabelPrinter(name || "");
  message.success(name ? `This PC will use “${name}”` : "Printer set to auto-detect");
}

async function printSample() {
  try {
    const res = await printReceipt(SAMPLE_RECEIPT_SALE, SAMPLE_RECEIPT_ITEMS, form.value);
    if (res.warning) message.warning(res.warning);
    else message.success(`Sample sent to ${res.printerName || "printer"}`);
  } catch (e) {
    message.error(e.message || "Print failed");
  }
}

function onBrowserPrinted() {
  browserPrintSession?.resolve({ ok: true });
  browserPrintJob.value = null;
  browserPrintSession = null;
}

function onBrowserPrintError(e) {
  browserPrintSession?.reject(e instanceof Error ? e : new Error(String(e?.message || e)));
  browserPrintJob.value = null;
  browserPrintSession = null;
}

/** Default: browser → Windows dialog → Zebra (no local agent). */
async function printLabelSample() {
  printingLabelSample.value = true;
  try {
    const f = form.value;
    let w = Number(f.label_width_mm) || 40;
    let h = Number(f.label_height_mm) || 25;
    if (w === 50 && h === 30) {
      w = 40;
      h = 25;
    }
    browserPrintSession = createBrowserPrintSession();
    browserPrintJob.value = {
      labels: [
        {
          name: labelPreviewName.value,
          barcode: labelPreviewBarcode.value,
          price: labelPreviewPrice.value,
        },
      ],
      w,
      h,
    };
    await browserPrintSession.done;
    message.success("Sample sent to print dialog — select Zebra / ZDesigner");
  } catch (e) {
    message.error(e.message || "Label print failed");
    browserPrintJob.value = null;
    browserPrintSession = null;
  } finally {
    printingLabelSample.value = false;
  }
}

/** Advanced: raw ZPL via local bridge or cloud shop agent */
async function printLabelSampleZpl() {
  printingLabelSample.value = true;
  try {
    const f = form.value;
    let w = Number(f.label_width_mm) || 40;
    let h = Number(f.label_height_mm) || 25;
    if (w === 50 && h === 30) {
      w = 40;
      h = 25;
    }
    const zpl = buildLabelZpl(
      {
        name: labelPreviewName.value,
        barcode: labelPreviewBarcode.value,
        price: labelPreviewPrice.value,
      },
      w,
      h
    );
    const result = await sendZplToZebra(zpl, {
      printer: selectedLabelPrinter.value || undefined,
    });
    const via =
      result.mode === "queued"
        ? "shop cloud queue"
        : `local${result.host ? ` (${result.host})` : ""}`;
    message.success(`Sample printed via ${via} → ${result.printerName || "Zebra"}`);
    await refreshPrinterBridge();
  } catch (e) {
    message.error(e.message || "Label print failed");
    await refreshPrinterBridge();
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
      shopify_enabled: Boolean(s.shopify_enabled),
      shopify_shop_domain: s.shopify_shop_domain || "",
      shopify_location_id: s.shopify_location_id || null,
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

async function testShopifyConnection() {
  if (!supabaseConfigured) return;
  shopifyTesting.value = true;
  try {
    const res = await shopifyTestConnection(form.value.shopify_shop_domain);
    shopifyLocationOptions.value = (res.locations || []).map((l) => ({
      label: l.name,
      value: l.gid || l.id,
    }));
    if (!form.value.shopify_location_id && shopifyLocationOptions.value[0]) {
      form.value.shopify_location_id = shopifyLocationOptions.value[0].value;
    }
    message.success(`Connected to ${res.shop || "Shopify"} (${shopifyLocationOptions.value.length} location(s))`);
  } catch (e) {
    message.error(e.message || "Shopify connection failed");
  } finally {
    shopifyTesting.value = false;
  }
}

async function saveShopifySettings() {
  if (!supabaseConfigured || !settingsLoaded.value) return;
  shopifyBusy.value = true;
  try {
    await updateSettings(form.value);
    message.success("Shopify settings saved");
  } catch (e) {
    message.error(e.message || "Could not save Shopify settings");
  } finally {
    shopifyBusy.value = false;
  }
}

async function runShopifyPushAll() {
  shopifyBusy.value = true;
  shopifyProgress.value = "Starting push…";
  try {
    await updateSettings(form.value);
    const res = await shopifyPushAll({
      onProgress: ({ done, total, batch }) => {
        shopifyProgress.value = `Pushing batch ${batch}: ${done}/${total}`;
      },
    });
    const results = res.results || [];
    const ok = results.filter((r) => !r.error && !r.skipped).length;
    const skip = results.filter((r) => r.skipped).length;
    const fail = results.filter((r) => r.error).length;
    shopifyProgress.value = "";
    message.success(`Push done: ${ok} updated, ${skip} skipped, ${fail} failed`);
  } catch (e) {
    shopifyProgress.value = "";
    message.error(e.message || "Push failed");
  } finally {
    shopifyBusy.value = false;
  }
}

async function runShopifyPullStock() {
  shopifyBusy.value = true;
  shopifyProgress.value = "Starting pull…";
  try {
    await updateSettings(form.value);
    const res = await shopifyPullStock({
      onProgress: ({ done, total, batch }) => {
        shopifyProgress.value = `Pulling batch ${batch}: ${done}/${total}`;
      },
    });
    const results = res.results || [];
    const ok = results.filter((r) => !r.error && !r.skipped).length;
    const skip = results.filter((r) => r.skipped).length;
    const fail = results.filter((r) => r.error).length;
    shopifyProgress.value = "";
    message.success(`Pull done: ${ok} updated, ${skip} skipped, ${fail} failed`);
  } catch (e) {
    shopifyProgress.value = "";
    message.error(e.message || "Pull failed");
  } finally {
    shopifyBusy.value = false;
  }
}

async function runRegisterWebhooks() {
  shopifyBusy.value = true;
  try {
    await updateSettings(form.value);
    const res = await shopifyRegisterWebhooks();
    const created = res.created || [];
    const failed = created.filter((c) => c.error);
    const ok = created.filter((c) => !c.error);
    const already = ok.filter((c) => c.status === "already_registered").length;
    if (failed.length) {
      message.warning(
        `Webhooks: ${ok.length} ok, ${failed.length} failed — ${failed
          .map((f) => `${f.topic}: ${f.error}`)
          .join(" | ")}`
      );
    } else if (already === ok.length && ok.length) {
      message.success(`Webhooks already registered (${ok.length}) — ready to use`);
    } else {
      message.success(
        `Webhooks OK (${ok.length}${already ? `, ${already} already set` : ""}) → ${res.webhookUrl || ""}`
      );
    }
  } catch (e) {
    message.error(e.message || "Webhook register failed");
  } finally {
    shopifyBusy.value = false;
  }
}

onMounted(() => {
  load();
  refreshPrinterBridge();
});
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

    <NCard v-if="shopifyFeatureOn" title="Shopify sync" class="settings-full-section">
      <NText depth="3" style="display: block; margin-bottom: 12px; font-size: 13px">
        Hub Lite: stock/barcode sync, order notifications, Shopify online price + images (Shopify
        CDN only). POS unit prices stay separate; fulfill/refund stay in Shopify Admin. Scopes:
        products, inventory, locations, <code>read_orders</code>, <code>write_files</code>. Set Edge
        secrets <code>SHOPIFY_CLIENT_ID</code> + <code>SHOPIFY_CLIENT_SECRET</code> (or legacy
        <code>SHOPIFY_ADMIN_TOKEN</code>). Re-approve the app after adding scopes — see README.
      </NText>
      <NForm label-placement="top" class="form-grid-2">
        <NFormItem label="Enable inventory sync">
          <NSwitch v-model:value="form.shopify_enabled" :disabled="!supabaseConfigured" />
        </NFormItem>
        <NFormItem label="Shop domain">
          <NInput
            v-model:value="form.shopify_shop_domain"
            placeholder="my-store.myshopify.com"
            :disabled="!supabaseConfigured"
          />
        </NFormItem>
        <NFormItem label="Inventory location" class="span-2">
          <NSelect
            v-model:value="form.shopify_location_id"
            :options="shopifyLocationOptions"
            clearable
            filterable
            placeholder="Test connection to load locations"
            :disabled="!supabaseConfigured"
            style="width: 100%"
          />
        </NFormItem>
      </NForm>
      <NSpace class="settings-actions" wrap style="margin-top: 8px">
        <NButton
          :loading="shopifyTesting"
          :disabled="!supabaseConfigured"
          @click="testShopifyConnection"
        >
          Test connection
        </NButton>
        <NButton
          type="primary"
          :loading="shopifyBusy"
          :disabled="!supabaseConfigured"
          @click="saveShopifySettings"
        >
          Save Shopify settings
        </NButton>
        <NButton :loading="shopifyBusy" :disabled="!supabaseConfigured" @click="runShopifyPushAll">
          Push all (name / barcode / stock)
        </NButton>
        <NButton :loading="shopifyBusy" :disabled="!supabaseConfigured" @click="runShopifyPullStock">
          Pull stock
        </NButton>
        <NButton :loading="shopifyBusy" :disabled="!supabaseConfigured" @click="runRegisterWebhooks">
          Register webhooks
        </NButton>
      </NSpace>
      <NText depth="3" style="display: block; margin-top: 10px; font-size: 12px">
        New Shopify orders show an in-app toast + bell while this POS is open (polls every ~15s).
        Delete/cancel on Shopify restores stock on the next poll.
      </NText>
      <NText v-if="shopifyProgress" depth="3" style="display: block; margin-top: 10px; font-size: 13px">
        {{ shopifyProgress }}
      </NText>
    </NCard>

    <ScheduledDiscountsCard class="settings-full-section" />

    <BarcodePrintSheet
      v-if="browserPrintJob"
      :labels="browserPrintJob.labels"
      :width-mm="browserPrintJob.w"
      :height-mm="browserPrintJob.h"
      @printed="onBrowserPrinted"
      @print-error="onBrowserPrintError"
    />

    <NCard title="Shop label printing">
      <NText depth="3" style="display: block; margin-bottom: 12px; font-size: 13px">
        <b>Default (PROD):</b> Print sample opens the browser dialog — choose Zebra / ZDesigner. No
        bridge or agent needed on the shop PC (driver must be installed).
        <br />
        <b>Advanced:</b> raw ZPL / cloud agent is optional below if you still run
        <code>print-agent</code> on a shop PC.
      </NText>
      <NSpace vertical :size="10">
        <NText>
          Local bridge (this browser PC):
          <b :style="{ color: bridgeStatus.ok ? '#059669' : '#b91c1c' }">
            {{ bridgeStatus.ok ? "Online" : "Offline" }}
          </b>
          <span v-if="bridgeStatus.host"> — {{ bridgeStatus.host }}</span>
        </NText>
        <NText>
          Cloud agent heartbeat:
          <b
            :style="{
              color: shopStations.some((s) => stationIsOnline(s)) ? '#059669' : '#b91c1c',
            }"
          >
            {{
              shopStations.some((s) => stationIsOnline(s))
                ? `Online (${shopStations.find((s) => stationIsOnline(s))?.name || "shop"})`
                : "Offline / not seen"
            }}
          </b>
        </NText>
        <NText v-if="bridgeStatus.ok && bridgeStatus.printerName" depth="2">
          Local printer: {{ bridgeStatus.printerName }}
        </NText>
        <NText v-else-if="!bridgeStatus.ok" depth="2">
          {{ bridgeStatus.message }}
        </NText>
        <NFormItem v-if="bridgeStatus.zebraPrinters?.length" label="Prefer printer on this PC">
          <NSelect
            :value="selectedLabelPrinter"
            :options="bridgeStatus.zebraPrinters.map((n) => ({ label: n, value: n }))"
            clearable
            placeholder="Auto-detect"
            style="width: min(420px, 100%)"
            @update:value="saveLabelPrinterChoice"
          />
        </NFormItem>
        <NSpace>
          <NButton :loading="bridgeChecking" secondary @click="refreshPrinterBridge">
            Refresh agent status
          </NButton>
          <NButton type="primary" :loading="printingLabelSample" @click="printLabelSample">
            Print sample (browser → Zebra)
          </NButton>
          <NButton secondary :loading="printingLabelSample" @click="printLabelSampleZpl">
            Print sample (raw ZPL / agent)
          </NButton>
        </NSpace>
      </NSpace>
    </NCard>

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
