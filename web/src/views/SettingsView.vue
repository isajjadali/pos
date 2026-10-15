<script setup>
import { ref, onMounted } from "vue";
import { NCard, NForm, NFormItem, NInput, NInputNumber, NButton, useMessage } from "naive-ui";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { getSettings, updateSettings } from "../services/settings.js";

const message = useMessage();
const form = ref({
  store_name: "Dollar World by WABz",
  default_low_stock_threshold: 5,
  receipt_footer: "",
  label_width_mm: 50,
  label_height_mm: 30,
});
const saving = ref(false);

async function load() {
  if (!supabaseConfigured) return;
  const s = await getSettings();
  if (s) form.value = { ...form.value, ...s };
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
    <NCard style="max-width: 520px">
      <NForm>
        <NFormItem label="Store name"><NInput v-model:value="form.store_name" /></NFormItem>
        <NFormItem label="Currency"><NInput value="PKR" disabled /></NFormItem>
        <NFormItem label="Default low-stock threshold">
          <NInputNumber v-model:value="form.default_low_stock_threshold" :min="0" style="width: 100%" />
        </NFormItem>
        <NFormItem label="Receipt footer"><NInput v-model:value="form.receipt_footer" type="textarea" /></NFormItem>
        <NFormItem label="Label width (mm)"><NInputNumber v-model:value="form.label_width_mm" :min="20" style="width: 100%" /></NFormItem>
        <NFormItem label="Label height (mm)"><NInputNumber v-model:value="form.label_height_mm" :min="15" style="width: 100%" /></NFormItem>
      </NForm>
      <NButton type="primary" :loading="saving" :disabled="!supabaseConfigured" @click="save">Save</NButton>
    </NCard>
  </div>
</template>
