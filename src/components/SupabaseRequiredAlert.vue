<script setup>
import { NAlert, NButton } from "naive-ui";
import { supabaseConfigured } from "../lib/supabase.js";
</script>

<template>
  <NAlert v-if="!supabaseConfigured" type="warning" title="Supabase not connected" style="margin-bottom: 16px">
    Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env</code>, run the SQL
    migrations, then sign in. Demo mode cannot save vendors or products.
  </NAlert>
</template>
