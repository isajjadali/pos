<script setup>
import { ref, onMounted, watch, h } from "vue";
import {
  NButton,
  NSpace,
  NInput,
  NDataTable,
  NModal,
  NForm,
  NFormItem,
  NSwitch,
  NTag,
  useMessage,
} from "naive-ui";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { createVendor, listVendors, updateVendor } from "../services/vendors.js";

const message = useMessage();
const loading = ref(false);
const rows = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const search = ref("");
const activeOnly = ref(false);

const showModal = ref(false);
const editingId = ref(null);
const form = ref(emptyForm());
const saving = ref(false);

function emptyForm() {
  return {
    name: "",
    contact_person: "",
    phone: "",
    address: "",
    notes: "",
    is_active: true,
  };
}

const columns = [
  { title: "Name", key: "name" },
  { title: "Contact", key: "contact_person" },
  { title: "Phone", key: "phone" },
  {
    title: "Status",
    key: "is_active",
    render: (row) =>
      h(NTag, { type: row.is_active ? "success" : "default", size: "small" }, () =>
        row.is_active ? "Active" : "Inactive"
      ),
  },
  {
    title: "Actions",
    key: "actions",
    render: (row) =>
      h(
        NButton,
        { size: "small", onClick: () => openEdit(row) },
        { default: () => "Edit" }
      ),
  },
];

async function load() {
  if (!supabaseConfigured) return;
  loading.value = true;
  try {
    const res = await listVendors({
      search: search.value,
      activeOnly: activeOnly.value,
      page: page.value,
      pageSize: pageSize.value,
    });
    rows.value = res.rows;
    total.value = res.total;
  } catch (e) {
    message.error(e.message || "Failed to load vendors");
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editingId.value = null;
  form.value = emptyForm();
  showModal.value = true;
}

function openEdit(row) {
  editingId.value = row.id;
  form.value = {
    name: row.name,
    contact_person: row.contact_person || "",
    phone: row.phone || "",
    address: row.address || "",
    notes: row.notes || "",
    is_active: row.is_active,
  };
  showModal.value = true;
}

async function save() {
  if (!supabaseConfigured) return;
  saving.value = true;
  try {
    if (editingId.value) {
      await updateVendor(editingId.value, form.value);
      message.success("Vendor updated");
    } else {
      await createVendor(form.value);
      message.success("Vendor created");
    }
    showModal.value = false;
    await load();
  } catch (e) {
    message.error(e.message || "Save failed");
  } finally {
    saving.value = false;
  }
}

function onPageChange(p) {
  page.value = p;
  load();
}

function onPageSizeChange(s) {
  pageSize.value = s;
  page.value = 1;
  load();
}
let searchTimer;
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    load();
  }, 300);
});
watch(activeOnly, () => {
  page.value = 1;
  load();
});

onMounted(load);
</script>

<template>
  <div>
    <h1 style="margin-top: 0">Vendors</h1>
    <SupabaseRequiredAlert />
    <NSpace style="margin-bottom: 16px" wrap>
      <NInput v-model:value="search" placeholder="Search vendor name" clearable style="width: 260px" />
      <NSwitch v-model:value="activeOnly">
        <template #checked>Active only</template>
        <template #unchecked>All vendors</template>
      </NSwitch>
      <NButton type="primary" :disabled="!supabaseConfigured" @click="openCreate">Add vendor</NButton>
      <NButton :disabled="!supabaseConfigured" @click="load">Refresh</NButton>
    </NSpace>
    <NDataTable
      :loading="loading"
      :columns="columns"
      :data="rows"
      :pagination="{
        page,
        pageSize,
        itemCount: total,
        showSizePicker: true,
        pageSizes: [10, 20, 50],
        onChange: onPageChange,
        onUpdatePageSize: onPageSizeChange,
      }"
    />
    <NModal v-model:show="showModal" preset="card" :title="editingId ? 'Edit vendor' : 'Add vendor'" style="width: 520px">
      <NForm>
        <NFormItem label="Vendor name" required>
          <NInput v-model:value="form.name" />
        </NFormItem>
        <NFormItem label="Contact person">
          <NInput v-model:value="form.contact_person" />
        </NFormItem>
        <NFormItem label="Phone">
          <NInput v-model:value="form.phone" />
        </NFormItem>
        <NFormItem label="Address">
          <NInput v-model:value="form.address" type="textarea" :rows="2" />
        </NFormItem>
        <NFormItem label="Notes">
          <NInput v-model:value="form.notes" type="textarea" :rows="2" />
        </NFormItem>
        <NFormItem label="Active">
          <NSwitch v-model:value="form.is_active" />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showModal = false">Cancel</NButton>
          <NButton type="primary" :loading="saving" @click="save">Save</NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>
