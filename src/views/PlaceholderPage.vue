<script setup>
import { NCard, NText, NTag } from "naive-ui";

defineProps({
  title: { type: String, required: true },
  phase: { type: String, default: "Upcoming" },
  description: { type: String, default: "" },
});
</script>

<template>
  <div>
    <h1 style="margin: 0 0 8px">{{ title }}</h1>
    <NTag type="info" size="small" style="margin-bottom: 16px">{{ phase }}</NTag>
    <NCard>
      <NText>{{ description || "This section will be implemented in the next development phase." }}</NText>
    </NCard>
  </div>
</template>
