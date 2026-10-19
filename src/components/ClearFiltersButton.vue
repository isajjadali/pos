<script setup>
import { NButton } from "naive-ui";

defineProps({
  disabled: { type: Boolean, default: true },
});

defineEmits(["clear"]);
</script>

<template>
  <NButton quaternary :disabled="disabled" @click="$emit('clear')">Clear filters</NButton>
</template>
