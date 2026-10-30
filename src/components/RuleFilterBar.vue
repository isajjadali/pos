<script setup>
/**
 * Jira-style basic filters: chips + Add filter row (field / op / value).
 * Click a chip to edit it; ✕ removes it.
 *
 * Field def: { id, label, hint?, valueType, ops?, options?, occupied, chipText, apply, clear, getDraft?, defaultNumber?, precision?, placeholder? }
 * apply/getDraft draft: { op, number, text, multi, select, createdPreset, createdFrom, createdTo }
 */
import { computed, nextTick, ref, watch } from "vue";
import {
  NButton,
  NInput,
  NInputNumber,
  NSelect,
  NSpace,
  NTag,
  NText,
} from "naive-ui";
import CreatedDateFilter from "./CreatedDateFilter.vue";
import {
  COMPARE_OPS,
  CONTAINS_OPS,
  FLAG_OPS,
  IN_OPS,
  IS_ANY_OPS,
  IS_OPS,
  PRESENCE_OPS,
} from "../utils/ruleFilterOps.js";

const props = defineProps({
  fields: { type: Array, default: () => [] },
  emptyHint: {
    type: String,
    default:
      "Add filters — field, then condition, then value. Click a chip to edit. Results stay visible below.",
  },
});

function defaultOpsFor(valueType) {
  switch (valueType) {
    case "number":
      return COMPARE_OPS;
    case "text":
      return CONTAINS_OPS;
    case "multi":
      return IS_ANY_OPS;
    case "select":
      return IS_OPS;
    case "presence":
      return PRESENCE_OPS;
    case "flag":
      return FLAG_OPS;
    case "created":
      return IN_OPS;
    default:
      return IS_OPS;
  }
}

const fieldList = computed(() =>
  (props.fields || []).filter((f) => f && f.id && typeof f.occupied === "function")
);

const fieldById = computed(() => Object.fromEntries(fieldList.value.map((f) => [f.id, f])));

const chips = computed(() =>
  fieldList.value
    .filter((f) => f.occupied())
    .map((f) => ({ id: f.id, text: f.chipText?.() || f.label }))
);

const draftOpen = ref(false);
/** null = adding new; field id = editing existing chip */
const editingId = ref(null);
const draftField = ref("");
const draftOp = ref("eq");
const draftNumber = ref(null);
const draftText = ref("");
const draftMulti = ref([]);
const draftSelect = ref(null);
const draftCreatedPreset = ref("week");
const draftCreatedFrom = ref(null);
const draftCreatedTo = ref(null);
let suppressFieldWatch = false;

const isEditing = computed(() => Boolean(editingId.value));

const availableFields = computed(() =>
  fieldList.value.filter((f) => !f.occupied() || f.id === draftField.value)
);

const currentField = computed(() => fieldById.value[draftField.value] || availableFields.value[0]);

const draftOpOptions = computed(
  () => currentField.value?.ops || defaultOpsFor(currentField.value?.valueType)
);

const fieldSelectOptions = computed(() =>
  availableFields.value.map((f) => ({ label: f.label, value: f.id }))
);

function resolveOptions(field) {
  if (!field) return [];
  const o = field.options;
  return typeof o === "function" ? o() || [] : o || [];
}

function applyDraftValues(d) {
  if (!d) return;
  if (d.op != null) draftOp.value = d.op;
  if (d.number != null && Number.isFinite(Number(d.number))) draftNumber.value = Number(d.number);
  if (d.text != null) draftText.value = String(d.text);
  if (Array.isArray(d.multi)) draftMulti.value = [...d.multi];
  if (d.select !== undefined) draftSelect.value = d.select;
  if (d.createdPreset != null) draftCreatedPreset.value = d.createdPreset;
  if (d.createdFrom !== undefined) draftCreatedFrom.value = d.createdFrom;
  if (d.createdTo !== undefined) draftCreatedTo.value = d.createdTo;
}

function resetDraftForField(id) {
  const f = fieldById.value[id];
  if (!f) return;
  const ops = f.ops || defaultOpsFor(f.valueType);
  draftOp.value = ops[0]?.value || "eq";
  // Keep number empty on add so the user can type without clearing 0.00
  draftNumber.value = null;
  draftText.value = "";
  draftMulti.value = [];
  draftSelect.value = resolveOptions(f)[0]?.value ?? null;
  draftCreatedPreset.value = "week";
  draftCreatedFrom.value = null;
  draftCreatedTo.value = null;
}

function loadDraftForField(id) {
  const f = fieldById.value[id];
  if (!f) return;
  resetDraftForField(id);
  const existing = f.getDraft?.();
  if (existing) applyDraftValues(existing);
}

watch(draftField, (id) => {
  if (suppressFieldWatch || !id) return;
  // Changing field while editing abandons edit of the previous chip
  if (editingId.value && editingId.value !== id) editingId.value = null;
  resetDraftForField(id);
});

async function setDraftFieldQuiet(id) {
  suppressFieldWatch = true;
  draftField.value = id;
  await nextTick();
  suppressFieldWatch = false;
}

function openAdd() {
  const first = availableFields.value.find((f) => !f.occupied()) || availableFields.value[0];
  if (!first) return;
  editingId.value = null;
  setDraftFieldQuiet(first.id).then(() => {
    resetDraftForField(first.id);
    draftOpen.value = true;
  });
}

function openEdit(id) {
  const f = fieldById.value[id];
  if (!f) return;
  editingId.value = id;
  setDraftFieldQuiet(id).then(() => {
    loadDraftForField(id);
    draftOpen.value = true;
  });
}

function cancelDraft() {
  draftOpen.value = false;
  editingId.value = null;
}

function removeChip(id) {
  if (editingId.value === id) cancelDraft();
  fieldById.value[id]?.clear?.();
}

function applyDraft() {
  const f = currentField.value;
  if (!f) return;
  if (
    f.valueType === "number" &&
    (draftNumber.value === null || draftNumber.value === undefined || !Number.isFinite(Number(draftNumber.value)))
  ) {
    return;
  }
  const previousId = editingId.value;
  // If user switched field while "editing", clear the old chip first
  if (previousId && previousId !== f.id) {
    fieldById.value[previousId]?.clear?.();
  }
  const ok = f.apply?.({
    op: draftOp.value,
    number: draftNumber.value,
    text: draftText.value,
    multi: [...(draftMulti.value || [])],
    select: draftSelect.value,
    createdPreset: draftCreatedPreset.value,
    createdFrom: draftCreatedFrom.value,
    createdTo: draftCreatedTo.value,
  });
  if (ok === false) return;
  draftOpen.value = false;
  editingId.value = null;
}

defineExpose({ chipCount: computed(() => chips.value.length), openAdd, openEdit });
</script>

<template>
  <div class="rfb">
    <div class="rfb__bar">
      <NSpace align="center" wrap :size="8">
        <NTag
          v-for="chip in chips"
          :key="chip.id"
          class="rfb__chip"
          closable
          size="small"
          :type="editingId === chip.id ? 'warning' : 'info'"
          :bordered="false"
          @click="openEdit(chip.id)"
          @close="removeChip(chip.id)"
        >
          {{ chip.text }}
        </NTag>
        <NButton
          v-if="!draftOpen && availableFields.some((f) => !f.occupied())"
          size="small"
          quaternary
          type="primary"
          @click="openAdd"
        >
          + Add filter
        </NButton>
        <NText v-if="!chips.length && !draftOpen" depth="3" class="rfb__empty">
          {{ emptyHint }}
        </NText>
      </NSpace>
    </div>

    <div v-if="draftOpen" class="rfb__draft">
      <NText v-if="currentField?.hint" depth="3" class="rfb__hint">{{ currentField.hint }}</NText>
      <div class="rfb__draft-row">
        <NSelect
          v-model:value="draftField"
          :options="fieldSelectOptions"
          :disabled="isEditing"
          filterable
          placeholder="Field"
          class="rfb__field"
        />
        <NSelect
          v-if="currentField?.valueType !== 'flag' && currentField?.valueType !== 'created'"
          v-model:value="draftOp"
          :options="draftOpOptions"
          class="rfb__op"
        />
        <NText v-else-if="currentField?.valueType === 'flag'" class="rfb__op-text">is true</NText>
        <NText v-else-if="currentField?.valueType === 'created'" class="rfb__op-text">is in</NText>

        <NInputNumber
          v-if="currentField?.valueType === 'number'"
          v-model:value="draftNumber"
          :min="0"
          :precision="currentField.precision ?? 0"
          clearable
          placeholder="Value"
          class="rfb__value"
        />
        <NInput
          v-else-if="currentField?.valueType === 'text'"
          v-model:value="draftText"
          clearable
          :placeholder="currentField.placeholder || 'Type text…'"
          class="rfb__value"
        />
        <NSelect
          v-else-if="currentField?.valueType === 'multi'"
          v-model:value="draftMulti"
          :options="resolveOptions(currentField)"
          multiple
          filterable
          clearable
          max-tag-count="responsive"
          placeholder="Select…"
          class="rfb__value"
        />
        <NSelect
          v-else-if="currentField?.valueType === 'select'"
          v-model:value="draftSelect"
          :options="resolveOptions(currentField)"
          class="rfb__value"
        />
        <div v-else-if="currentField?.valueType === 'created'" class="rfb__created">
          <CreatedDateFilter
            v-model:preset="draftCreatedPreset"
            v-model:from="draftCreatedFrom"
            v-model:to="draftCreatedTo"
          />
        </div>

        <NButton type="primary" size="small" @click="applyDraft">
          {{ isEditing ? "Update" : "Add" }}
        </NButton>
        <NButton size="small" quaternary @click="cancelDraft">Cancel</NButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rfb {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0 0 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.03);
  border: 1px solid rgba(15, 23, 42, 0.08);
}
.rfb__chip {
  cursor: pointer;
}
.rfb__empty {
  font-size: 12px;
}
.rfb__hint {
  display: block;
  font-size: 12px;
  margin-bottom: 6px;
}
.rfb__draft {
  padding-top: 4px;
  border-top: 1px dashed rgba(15, 23, 42, 0.1);
}
.rfb__draft-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.rfb__field {
  width: 200px;
  min-width: 160px;
}
.rfb__op {
  width: 150px;
  min-width: 130px;
}
.rfb__op-text {
  font-size: 13px;
  color: #4b5563;
  white-space: nowrap;
}
.rfb__value {
  width: 220px;
  min-width: 140px;
  flex: 1 1 160px;
  max-width: 360px;
}
.rfb__created {
  flex: 1 1 280px;
  min-width: 220px;
}
</style>
