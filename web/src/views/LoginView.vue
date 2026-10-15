<script setup>
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { NForm, NFormItem, NInput, NButton, NAlert, NText } from "naive-ui";
import { useAuthStore } from "../stores/auth.js";
import { usePermissions } from "../composables/usePermissions.js";
import { supabaseConfigured } from "../lib/supabase.js";

const auth = useAuthStore();
const { defaultHomeRoute } = usePermissions();
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
    const redirect = route.query.redirect;
    if (redirect && typeof redirect === "string") {
      router.push(redirect);
    } else {
      router.push({ name: defaultHomeRoute.value });
    }
  } finally {
    submitting.value = false;
  }
}

function enterDemo() {
  router.push({ name: "dashboard" });
}
</script>

<template>
  <div class="login-page">
    <div class="login-shell">
      <aside class="login-hero" aria-hidden="true">
        <div class="hero-inner">
          <p class="hero-eyebrow">Retail POS</p>
          <h2 class="hero-title">Dollar World<br />by WABz</h2>
          <p class="hero-tagline">
            Fast checkout, live stock, and labels — built for your shop floor.
          </p>
        </div>
        <div class="hero-orbs">
          <span class="orb orb-a" />
          <span class="orb orb-b" />
        </div>
      </aside>

      <section class="login-panel">
        <header class="panel-header">
          <h1 class="panel-title">Welcome back</h1>
          <NText depth="2">Sign in with your staff account</NText>
        </header>

        <NAlert v-if="!supabaseConfigured" type="warning" style="margin-bottom: 20px">
          Supabase is not configured. Use demo mode to explore the layout only.
        </NAlert>

        <NForm class="login-form" @submit.prevent="submit">
          <NFormItem label="Email" :show-feedback="false">
            <NInput
              v-model:value="email"
              type="email"
              size="large"
              placeholder="you@shop.com"
              autocomplete="username"
            />
          </NFormItem>
          <NFormItem label="Password" class="password-field" :show-feedback="false">
            <NInput
              v-model:value="password"
              type="password"
              size="large"
              placeholder="••••••••"
              autocomplete="current-password"
              show-password-on="click"
            />
          </NFormItem>

          <NButton
            type="primary"
            size="large"
            block
            strong
            :loading="submitting"
            attr-type="submit"
            class="sign-in-btn"
          >
            Sign in
          </NButton>

          <NButton v-if="!supabaseConfigured" block size="large" quaternary @click="enterDemo">
            Continue in demo mode
          </NButton>

          <NAlert v-if="auth.error" type="error" style="margin-top: 16px">{{ auth.error }}</NAlert>
        </NForm>

        <p class="panel-foot">Admins manage stock & settings · Sales use POS & catalog</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 20px;
  background:
    radial-gradient(ellipse 80% 60% at 10% 0%, rgba(15, 118, 110, 0.12), transparent 55%),
    radial-gradient(ellipse 70% 50% at 100% 100%, rgba(30, 64, 175, 0.08), transparent 50%),
    linear-gradient(165deg, #f0fdfa 0%, #f8fafc 42%, #eef2ff 100%);
}

.login-shell {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
  width: min(920px, 100%);
  min-height: 520px;
  border-radius: 20px;
  overflow: hidden;
  background: #fff;
  box-shadow:
    0 4px 6px -1px rgba(15, 23, 42, 0.06),
    0 24px 48px -12px rgba(15, 23, 42, 0.18);
  border: 1px solid rgba(148, 163, 184, 0.35);
}

.login-hero {
  position: relative;
  padding: 48px 40px;
  background: linear-gradient(145deg, #0f766e 0%, #115e59 48%, #134e4a 100%);
  color: #ecfdf5;
  overflow: hidden;
}

.hero-inner {
  position: relative;
  z-index: 1;
  max-width: 280px;
}

.hero-eyebrow {
  margin: 0 0 12px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  opacity: 0.85;
}

.hero-title {
  margin: 0 0 16px;
  font-size: clamp(1.75rem, 4vw, 2.25rem);
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.02em;
}

.hero-tagline {
  margin: 0;
  font-size: 15px;
  line-height: 1.55;
  opacity: 0.9;
}

.hero-orbs .orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(0);
  opacity: 0.35;
}
.orb-a {
  width: 220px;
  height: 220px;
  right: -60px;
  top: -40px;
  background: radial-gradient(circle, #5eead4 0%, transparent 70%);
}
.orb-b {
  width: 280px;
  height: 280px;
  left: -80px;
  bottom: -100px;
  background: radial-gradient(circle, #2dd4bf 0%, transparent 65%);
}

.login-panel {
  padding: 48px 40px 32px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.panel-header {
  margin-bottom: 28px;
}

.panel-title {
  margin: 0 0 6px;
  font-size: 1.5rem;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.02em;
}

.login-form {
  max-width: 100%;
}

.login-form :deep(.password-field) {
  margin-top: 14px;
}

.sign-in-btn {
  margin-top: 8px;
  height: 44px;
  font-weight: 600;
}

.panel-foot {
  margin: 28px 0 0;
  font-size: 12px;
  color: #64748b;
  text-align: center;
  line-height: 1.45;
}

@media (max-width: 768px) {
  .login-shell {
    grid-template-columns: 1fr;
    min-height: auto;
  }
  .login-hero {
    padding: 32px 28px 36px;
  }
  .hero-title br {
    display: none;
  }
  .login-panel {
    padding: 32px 28px 28px;
  }
}
</style>
