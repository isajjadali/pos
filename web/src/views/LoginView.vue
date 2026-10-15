<script setup>
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { NCard, NForm, NFormItem, NInput, NButton, NAlert, NSpace, NText } from "naive-ui";
import { useAuthStore } from "../stores/auth.js";
import { supabaseConfigured } from "../lib/supabase.js";

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const email = ref("");
const password = ref("");
const submitting = ref(false);

async function submit() {
  if (!supabaseConfigured) {
    router.push({ name: "dashboard" });
    return;
  }
  submitting.value = true;
  try {
    await auth.signIn(email.value, password.value);
    router.push(route.query.redirect || "/");
  } finally {
    submitting.value = false;
  }
}

function enterDemo() {
  router.push({ name: "dashboard" });
}
</script>

<template>
  <div class="login-wrap">
    <NCard title="Dollar World by WABz" style="max-width: 420px; width: 100%">
      <NText depth="3">Staff sign in</NText>
      <NAlert v-if="supabaseConfigured" type="info" style="margin: 16px 0">
        Pehli dafa? Supabase Dashboard → <strong>Authentication</strong> → <strong>Users</strong> →
        <strong>Add user</strong> → Create new user (email + password). Phir yahan wahi se sign in karein.
        SQL migrations project ke <code>supabase/migrations/</code> folder se pehle run karein.
      </NAlert>
      <NAlert v-if="!supabaseConfigured" type="warning" style="margin: 16px 0">
        Supabase is not configured. Use demo mode to explore the layout only.
      </NAlert>
      <NForm @submit.prevent="submit">
        <NFormItem label="Email">
          <NInput v-model:value="email" type="email" autocomplete="username" />
        </NFormItem>
        <NFormItem label="Password">
          <NInput v-model:value="password" type="password" autocomplete="current-password" />
        </NFormItem>
        <NSpace vertical style="width: 100%">
          <NButton type="primary" block :loading="submitting" attr-type="submit">Sign in</NButton>
          <NButton v-if="!supabaseConfigured" block @click="enterDemo">Continue in demo mode</NButton>
        </NSpace>
        <NAlert v-if="auth.error" type="error" style="margin-top: 12px">{{ auth.error }}</NAlert>
      </NForm>
    </NCard>
  </div>
</template>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: #f5f6f8;
}
</style>
