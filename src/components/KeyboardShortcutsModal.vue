<script setup>
import { NModal, NTable } from "naive-ui";
import { SHORTCUT_GROUPS } from "../utils/hotkeys.js";

defineProps({
  show: { type: Boolean, default: false },
});

const emit = defineEmits(["update:show"]);

const columns = [
  { title: "Keys", key: "keys", width: 160 },
  { title: "Action", key: "desc" },
];
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="Keyboard shortcuts"
    style="width: min(640px, 96vw); max-height: 85vh"
    @update:show="emit('update:show', $event)"
  >
    <p style="margin-top: 0; color: #4b5563; font-size: 14px">
      Use Alt + number to jump pages. On POS, F-keys work even while the cursor is in the scan box.
    </p>
    <div v-for="group in SHORTCUT_GROUPS" :key="group.title" style="margin-bottom: 20px">
      <h3 style="margin: 0 0 8px; font-size: 15px">{{ group.title }}</h3>
      <NTable :columns="columns" :data="group.items" :bordered="false" size="small" />
    </div>
  </NModal>
</template>
