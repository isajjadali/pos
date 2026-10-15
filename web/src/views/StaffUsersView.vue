<script setup>
import { ref, onMounted, h, computed } from "vue";
import {
  NButton,
  NSpace,
  NDataTable,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NTag,
  NAlert,
  NText,
  useMessage,
} from "naive-ui";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { useAuthStore } from "../stores/auth.js";
import { listStaffUsers, updateStaffUser, createStaffUser } from "../services/staff.js";

const message = useMessage();
const auth = useAuthStore();

const loading = ref(false);
const rows = ref([]);

const showCreate = ref(false);
const showEdit = ref(false);
const saving = ref(false);
const editing = ref(null);

const createForm = ref(emptyCreateForm());

const roleOptions = [
  { label: "Administrator — full access", value: "admin" },
  { label: "Sales — POS & catalog (sale prices only)", value: "sales" },
];

function emptyCreateForm() {
  return { email: "", password: "", full_name: "", role: "sales" };
}

function emptyEditForm() {
  return { full_name: "", role: "sales" };
}

const editForm = ref(emptyEditForm());

const columns = [
  { title: "Name", key: "full_name", render: (row) => row.full_name || "—" },
  { title: "Email", key: "email", ellipsis: { tooltip: true } },
  {
    title: "Role",
    key: "role",
    width: 120,
    render: (row) =>
      h(
        NTag,
        { type: row.role === "admin" ? "info" : "default", size: "small" },
        () => (row.role === "admin" ? "Admin" : "Sales")
      ),
  },
  {
    title: "",
    key: "actions",
    width: 90,
    render: (row) =>
      h(
        NButton,
        { size: "small", onClick: () => openEdit(row) },
        { default: () => "Edit" }
      ),
  },
];

const isEditingSelf = computed(() => editing.value?.id === auth.user?.id);

async function load() {
  if (!supabaseConfigured) return;
  loading.value = true;
  try {
    rows.value = await listStaffUsers();
  } catch (e) {
    message.error(e.message || "Could not load staff");
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  createForm.value = emptyCreateForm();
  showCreate.value = true;
}

function openEdit(row) {
  editing.value = row;
  editForm.value = {
    full_name: row.full_name || "",
    role: row.role || "sales",
  };
  showEdit.value = true;
}

async function saveCreate() {
  saving.value = true;
  try {
    await createStaffUser(createForm.value);
    message.success("Staff account created");
    showCreate.value = false;
    await load();
  } catch (e) {
    const msg = e.message || "Create failed";
    if (msg.includes("Failed to send a request to the Edge Function")) {
      message.error(
        "Create user needs the create-staff-user Edge Function deployed (see supabase/functions)."
      );
    } else {
      message.error(msg);
    }
  } finally {
    saving.value = false;
  }
}

async function saveEdit() {
  if (!editing.value) return;
  saving.value = true;
  try {
    await updateStaffUser(editing.value.id, editForm.value);
    message.success("Staff updated");
    showEdit.value = false;
    if (editing.value.id === auth.user?.id) {
      await auth.loadProfile();
    }
    await load();
  } catch (e) {
    message.error(e.message || "Update failed");
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <h1 style="margin-top: 0">Staff users</h1>
    <NText depth="2" style="display: block; margin-bottom: 16px; max-width: 640px">
      Login uses Supabase Auth (<code>auth.users</code>) plus your shop profile (
      <code>profiles</code>) for role: Admin or Sales. Create accounts here and assign permissions.
    </NText>
    <SupabaseRequiredAlert />
    <NAlert type="info" style="margin-bottom: 16px" :bordered="false">
      New users need the <strong>create-staff-user</strong> Edge Function on your Supabase project
      (<code>supabase functions deploy create-staff-user</code>). Listing and role edits work via
      database RPC after migrations are applied.
    </NAlert>
    <NSpace style="margin-bottom: 16px">
      <NButton type="primary" :disabled="!supabaseConfigured" @click="openCreate">
        Add staff user
      </NButton>
      <NButton :disabled="!supabaseConfigured" @click="load">Refresh</NButton>
    </NSpace>
    <NDataTable :loading="loading" :columns="columns" :data="rows" :row-key="(r) => r.id" />
  </div>

  <NModal v-model:show="showCreate" preset="card" title="New staff account" style="width: 440px">
    <NForm label-placement="top">
      <NFormItem label="Full name">
        <NInput v-model:value="createForm.full_name" placeholder="Optional display name" />
      </NFormItem>
      <NFormItem label="Email" required>
        <NInput v-model:value="createForm.email" type="email" autocomplete="off" />
      </NFormItem>
      <NFormItem label="Password" required>
        <NInput
          v-model:value="createForm.password"
          type="password"
          show-password-on="click"
          autocomplete="new-password"
          placeholder="Min 6 characters"
        />
      </NFormItem>
      <NFormItem label="Role">
        <NSelect v-model:value="createForm.role" :options="roleOptions" />
      </NFormItem>
    </NForm>
    <template #footer>
      <NSpace justify="end">
        <NButton @click="showCreate = false">Cancel</NButton>
        <NButton type="primary" :loading="saving" @click="saveCreate">Create</NButton>
      </NSpace>
    </template>
  </NModal>

  <NModal v-model:show="showEdit" preset="card" title="Edit staff" style="width: 440px">
    <NText v-if="editing" depth="2" style="display: block; margin-bottom: 12px">
      {{ editing.email }}
    </NText>
    <NAlert v-if="isEditingSelf" type="warning" style="margin-bottom: 12px" :bordered="false">
      You cannot remove your own admin role.
    </NAlert>
    <NForm label-placement="top">
      <NFormItem label="Full name">
        <NInput v-model:value="editForm.full_name" />
      </NFormItem>
      <NFormItem label="Role">
        <NSelect
          v-model:value="editForm.role"
          :options="roleOptions"
          :disabled="isEditingSelf && editForm.role === 'admin'"
        />
      </NFormItem>
    </NForm>
    <template #footer>
      <NSpace justify="end">
        <NButton @click="showEdit = false">Cancel</NButton>
        <NButton type="primary" :loading="saving" @click="saveEdit">Save</NButton>
      </NSpace>
    </template>
  </NModal>
</template>
