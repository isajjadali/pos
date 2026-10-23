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
  useDialog,
} from "naive-ui";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { useAuthStore } from "../stores/auth.js";
import {
  listStaffUsers,
  updateStaffUser,
  createStaffUser,
  updateStaffPassword,
  deleteStaffUser,
} from "../services/staff.js";
import { rowNumberColumn, createdAtColumn, fitNameColumnWidth } from "../utils/tableColumns.js";
import { toTitleCase } from "../utils/titleCase.js";

const message = useMessage();
const dialog = useDialog();
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
  return { full_name: "", role: "sales", new_password: "", confirm_password: "" };
}

const editForm = ref(emptyEditForm());

const nameColumnWidth = computed(() => fitNameColumnWidth(rows.value, "full_name"));
const tableScrollX = computed(() => 52 + nameColumnWidth.value + 220 + 120 + 158 + 168 + 24);

const columns = computed(() => [
  rowNumberColumn(1, 100),
  {
    title: "Name",
    key: "full_name",
    width: nameColumnWidth.value,
    ellipsis: { tooltip: true },
    render: (row) => row.full_name || "—",
  },
  { title: "Email", key: "email", width: 220, ellipsis: { tooltip: true } },
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
  createdAtColumn(),
  {
    title: "",
    key: "actions",
    width: 168,
    render: (row) =>
      h(NSpace, { size: "small" }, () => [
        h(NButton, { size: "small", onClick: () => openEdit(row) }, { default: () => "Edit" }),
        h(
          NButton,
          {
            size: "small",
            type: "error",
            quaternary: true,
            disabled: row.id === auth.user?.id || row.role === "admin",
            onClick: () => confirmDeleteStaff(row),
          },
          { default: () => "Delete" }
        ),
      ]),
  },
]);

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
    new_password: "",
    confirm_password: "",
  };
  showEdit.value = true;
}

async function saveCreate() {
  saving.value = true;
  try {
    createForm.value.full_name = toTitleCase(createForm.value.full_name);
    await createStaffUser(createForm.value);
    message.success("Staff account created");
    showCreate.value = false;
    await load();
  } catch (e) {
    const msg = e.message || "Create failed";
    if (msg.includes("Failed to send a request to the Edge Function")) {
      message.error(edgeFunctionHint("create-staff-user"));
    } else {
      message.error(msg);
    }
  } finally {
    saving.value = false;
  }
}

function edgeFunctionHint(fnName) {
  return `${fnName} Edge Function must be deployed (supabase functions deploy ${fnName}).`;
}

function confirmDeleteStaff(row) {
  if (row.id === auth.user?.id) {
    message.warning("You cannot delete your own account");
    return;
  }
  if (row.role === "admin") {
    message.warning("Change this user to Sales first, then you can delete them.");
    return;
  }
  const label = row.full_name || row.email || "this user";
  dialog.warning({
    title: "Delete staff user?",
    content: `Remove ${label}? They will not be able to sign in again.`,
    positiveText: "Delete",
    negativeText: "Cancel",
    onPositiveClick: async () => {
      try {
        await deleteStaffUser(row.id);
        message.success("Staff user deleted");
        await load();
      } catch (e) {
        const msg = e.message || "Delete failed";
        if (msg.includes("Failed to send a request to the Edge Function")) {
          message.error(edgeFunctionHint("delete-staff-user"));
        } else {
          message.error(msg);
        }
      }
    },
  });
}

async function saveEdit() {
  if (!editing.value) return;
  const pwd = String(editForm.value.new_password || "");
  const confirm = String(editForm.value.confirm_password || "");
  if (pwd || confirm) {
    if (pwd.length < 6) {
      message.warning("Password must be at least 6 characters");
      return;
    }
    if (pwd !== confirm) {
      message.warning("Passwords do not match");
      return;
    }
  }

  saving.value = true;
  try {
    editForm.value.full_name = toTitleCase(editForm.value.full_name);
    await updateStaffUser(editing.value.id, editForm.value);
    if (pwd) {
      await updateStaffPassword(editing.value.id, pwd);
    }
    message.success(pwd ? "Staff updated and password changed" : "Staff updated");
    showEdit.value = false;
    if (editing.value.id === auth.user?.id) {
      await auth.loadProfile();
    }
    await load();
  } catch (e) {
    const msg = e.message || "Update failed";
    if (msg.includes("Failed to send a request to the Edge Function") && pwd) {
      message.error(edgeFunctionHint("update-staff-password"));
    } else {
      message.error(msg);
    }
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
      Creating accounts, resetting passwords, and deleting staff need Edge Functions:
      <code>create-staff-user</code>, <code>update-staff-password</code>,
      <code>delete-staff-user</code> (<code>supabase functions deploy …</code>). Administrators
      cannot be deleted until their role is changed to Sales. Listing and role edits use database
      RPCs.
    </NAlert>
    <NSpace class="app-filter-stack" style="margin-bottom: 16px" wrap>
      <NButton type="primary" :disabled="!supabaseConfigured" @click="openCreate">
        Add staff user
      </NButton>
      <NButton :disabled="!supabaseConfigured" @click="load">Refresh</NButton>
    </NSpace>
    <div class="app-table-scroll">
      <NDataTable
        :loading="loading"
        :columns="columns"
        :data="rows"
        :row-key="(r) => r.id"
        :scroll-x="tableScrollX"
      />
    </div>
  </div>

  <NModal v-model:show="showCreate" preset="card" title="New staff account" style="width: min(560px, 96vw)">
    <NForm label-placement="top" class="staff-form-grid">
      <NFormItem label="Full name" class="span-2">
        <NInput v-model:value="createForm.full_name" placeholder="Optional display name" />
      </NFormItem>
      <NFormItem label="Email" required class="span-2">
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

  <NModal v-model:show="showEdit" preset="card" title="Edit staff" style="width: min(480px, 96vw)">
    <NText v-if="editing" depth="2" style="display: block; margin-bottom: 12px">
      {{ editing.email }}
    </NText>
    <NAlert v-if="isEditingSelf" type="warning" style="margin-bottom: 12px" :bordered="false">
      You cannot remove your own admin role or delete your own account.
    </NAlert>
    <NAlert
      v-else-if="editing?.role === 'admin'"
      type="info"
      style="margin-bottom: 12px"
      :bordered="false"
    >
      To remove this user, change role to <strong>Sales</strong> and save, then use Delete on the
      staff list.
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
      <NText depth="3" style="display: block; margin: 8px 0 4px; font-size: 13px">
        Set a new login password (optional). Leave blank to keep the current password.
      </NText>
      <NFormItem label="New password">
        <NInput
          v-model:value="editForm.new_password"
          type="password"
          show-password-on="click"
          autocomplete="new-password"
          placeholder="Min 6 characters"
        />
      </NFormItem>
      <NFormItem label="Confirm new password">
        <NInput
          v-model:value="editForm.confirm_password"
          type="password"
          show-password-on="click"
          autocomplete="new-password"
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

<style scoped>
.staff-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 16px;
}
.staff-form-grid :deep(.n-form-item) {
  margin-bottom: 8px;
}
.span-2 {
  grid-column: span 2;
}
@media (max-width: 768px) {
  .staff-form-grid {
    grid-template-columns: 1fr;
  }
  .span-2 {
    grid-column: span 1;
  }
}
</style>
