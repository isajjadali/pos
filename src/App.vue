<script setup>
import { NConfigProvider, NMessageProvider, NDialogProvider } from "naive-ui";
import { themeOverrides } from "./theme.js";
</script>

<template>
  <NConfigProvider :theme-overrides="themeOverrides">
    <NMessageProvider>
      <NDialogProvider>
        <RouterView />
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
