<script setup>
import { NModal } from "naive-ui";
import { SHORTCUT_GROUPS } from "../utils/hotkeys.js";

defineProps({
  show: { type: Boolean, default: false },
});

const emit = defineEmits(["update:show"]);
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="Keyboard shortcuts"
    style="width: min(640px, 96vw)"
    :bordered="false"
    @update:show="emit('update:show', $event)"
  >
    <div class="shortcuts-modal-body">
      <p class="shortcuts-lead">
        F-keys on POS work even while the cursor is in the scan box. Press
        <kbd>Esc</kbd> to close this window.
      </p>
      <section v-for="group in SHORTCUT_GROUPS" :key="group.title" class="shortcuts-section">
        <h3 class="shortcuts-section-title">{{ group.title }}</h3>
        <p v-if="group.blurb" class="shortcuts-section-blurb">{{ group.blurb }}</p>
        <ul class="shortcuts-list">
          <li v-for="(item, i) in group.items" :key="i" class="shortcuts-row">
            <span class="shortcuts-keys">{{ item.keys }}</span>
            <span class="shortcuts-desc">{{ item.desc }}</span>
          </li>
        </ul>
      </section>
    </div>
  </NModal>
</template>

<style scoped>
.shortcuts-modal-body {
  max-height: min(70vh, 560px);
  overflow: auto;
  padding-right: 4px;
}
.shortcuts-lead {
  margin: 0 0 18px;
  color: #4b5563;
  font-size: 14px;
  line-height: 1.45;
}
.shortcuts-section {
  margin-bottom: 22px;
}
.shortcuts-section:last-child {
  margin-bottom: 4px;
}
.shortcuts-section-title {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 700;
  color: #0f766e;
}
.shortcuts-section-blurb {
  margin: 0 0 10px;
  font-size: 13px;
  color: #6b7280;
}
.shortcuts-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}
.shortcuts-row {
  display: grid;
  grid-template-columns: minmax(140px, 200px) 1fr;
  gap: 12px;
  align-items: baseline;
  padding: 10px 12px;
  border-bottom: 1px solid #f3f4f6;
  font-size: 13px;
}
.shortcuts-row:last-child {
  border-bottom: none;
}
.shortcuts-row:nth-child(even) {
  background: #f9fafb;
}
.shortcuts-keys {
  font-weight: 700;
  color: #111827;
  font-variant-numeric: tabular-nums;
}
.shortcuts-desc {
  color: #374151;
  line-height: 1.35;
}
kbd {
  display: inline-block;
  padding: 1px 5px;
  font-size: 11px;
  font-family: inherit;
  background: #e5e7eb;
  border: 1px solid #9ca3af;
  border-radius: 4px;
}
@media (max-width: 520px) {
  .shortcuts-row {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}
</style>
