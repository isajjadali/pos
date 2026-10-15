import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { requireSupabase, supabaseConfigured } from "../lib/supabase.js";

export const useAuthStore = defineStore("auth", () => {
  const user = ref(null);
  const loading = ref(true);
  const error = ref("");

  const isAuthenticated = computed(() => Boolean(user.value));

  async function init() {
    if (!supabaseConfigured) {
      loading.value = false;
      return;
    }
    const sb = requireSupabase();
    const { data } = await sb.auth.getSession();
    user.value = data.session?.user ?? null;
    sb.auth.onAuthStateChange((_event, session) => {
      user.value = session?.user ?? null;
    });
    loading.value = false;
  }

  async function signIn(email, password) {
    error.value = "";
    const sb = requireSupabase();
    const { data, error: err } = await sb.auth.signInWithPassword({ email, password });
    if (err) {
      error.value = err.message;
      throw err;
    }
    user.value = data.user;
    return data;
  }

  async function signOut() {
    const sb = requireSupabase();
    await sb.auth.signOut();
    user.value = null;
  }

  return { user, loading, error, isAuthenticated, init, signIn, signOut };
});
