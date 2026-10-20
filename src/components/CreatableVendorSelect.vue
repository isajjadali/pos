<script setup>
import { ref, computed, watch, nextTick } from "vue";
import { NSelect, useMessage } from "naive-ui";
import { createVendor } from "../services/vendors.js";
import { toTitleCase } from "../utils/titleCase.js";

const CREATE_PREFIX = "__create__:";

const props = defineProps({
  value: { default: null },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: "Vendor" },
  clearable: { type: Boolean, default: true },
  style: { type: [String, Object], default: "width: 260px" },
  disabled: { type: Boolean, default: false },
});

const emit = defineEmits(["update:value", "vendor-created"]);

const message = useMessage();
const localOptions = ref([]);
const creating = ref(false);
const filterQuery = ref("");
const selectRef = ref(null);

watch(
  () => props.options,
  (opts) => {
    const incoming = (opts || []).map((o) => ({ label: o.label, value: o.value }));
    const extras = localOptions.value.filter(
      (o) =>
        !incoming.some((i) => i.value === o.value) &&
        !String(o.value).startsWith("__pending__") &&
        !String(o.value).startsWith(CREATE_PREFIX)
    );
    localOptions.value = [...incoming, ...extras];
  },
  { immediate: true, deep: true }
);

function findByName(name) {
  const key = String(name ?? "")
    .trim()
    .toLowerCase();
  if (!key) return null;
  return localOptions.value.find((o) => String(o.label).trim().toLowerCase() === key) || null;
}

const displayOptions = computed(() => {
  const q = filterQuery.value.trim();
  const base = localOptions.value;
  if (!q) return base;
  if (findByName(q)) return base;
  const label = `Create “${toTitleCase(q)}”`;
  return [{ label, value: `${CREATE_PREFIX}${q}` }, ...base];
});

async function createNew(rawName) {
  const name = toTitleCase(String(rawName ?? "").trim());
  if (!name || creating.value) return;

  const existing = findByName(name);
  if (existing) {
    emit("update:value", existing.value);
    filterQuery.value = "";
    return;
  }

  creating.value = true;
  const tempValue = `__pending__${Date.now()}`;
  localOptions.value = [...localOptions.value, { label: name, value: tempValue }];
  emit("update:value", tempValue);
  filterQuery.value = "";

  try {
    const vendor = await createVendor({ name });
    const opt = { label: vendor.name, value: vendor.id };
    localOptions.value = localOptions.value.filter((o) => o.value !== tempValue).concat(opt);
    if (props.value === tempValue) emit("update:value", vendor.id);
    emit("vendor-created", vendor);
    message.success(`Vendor created: ${vendor.name}`);
  } catch (e) {
    localOptions.value = localOptions.value.filter((o) => o.value !== tempValue);
    if (props.value === tempValue) emit("update:value", null);
    message.error(e.message || "Could not create vendor");
  } finally {
    creating.value = false;
  }
}

function onUpdateValue(v) {
  if (v == null) {
    emit("update:value", null);
    return;
  }
  const s = String(v);
  if (s.startsWith(CREATE_PREFIX)) {
    createNew(s.slice(CREATE_PREFIX.length));
    return;
  }
  emit("update:value", v);
  filterQuery.value = "";
}

function onSearch(q) {
  filterQuery.value = q ?? "";
}

/** Enter / Tab while typing an unmatched name → create (or select existing). */
function onKeydown(e) {
  if (e.key !== "Enter" && e.key !== "Tab") return;
  const q = filterQuery.value.trim();
  if (!q) return;

  const existing = findByName(q);
  if (existing) {
    e.preventDefault();
    emit("update:value", existing.value);
    filterQuery.value = "";
    nextTick(() => selectRef.value?.blur?.());
    return;
  }

  // Unmatched typed name — create only on Enter/Tab
  e.preventDefault();
  createNew(q);
  nextTick(() => selectRef.value?.blur?.());
}
</script>

<template>
  <div class="creatable-vendor" @keydown="onKeydown">
    <NSelect
      ref="selectRef"
      :value="value"
      :options="displayOptions"
      :placeholder="placeholder"
      :clearable="clearable"
      :disabled="disabled || creating"
      filterable
      :style="style"
      :show-checkmark="false"
      @search="onSearch"
      @update:value="onUpdateValue"
    />
  </div>
</template>
