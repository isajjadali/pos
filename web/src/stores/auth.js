import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { requireSupabase, supabaseConfigured } from "../lib/supabase.js";
import { useProductCacheStore, clearProductCatalog, refreshProductCatalog } from "./productCache.js";

export const useAuthStore = defineStore("auth", () => {
  const user = ref(null);
  const profile = ref(null);
  const profileLoaded = ref(false);
  const loading = ref(true);
  const error = ref("");

  const isAuthenticated = computed(() => Boolean(user.value));

  const role = computed(() => {
    if (!supabaseConfigured) return "admin";
    return profile.value?.role ?? "sales";
  });

  const isAdmin = computed(() => !supabaseConfigured || role.value === "admin");
  const isSales = computed(() => supabaseConfigured && role.value === "sales");
  const displayName = computed(
    () => profile.value?.full_name || user.value?.email || "Staff"
  );

  function resetProfile() {
    profile.value = null;
    profileLoaded.value = false;
  }

  async function loadProfile() {
    if (!supabaseConfigured || !user.value) {
      resetProfile();
      profileLoaded.value = true;
      return;
    }
    profileLoaded.value = false;
    const sb = requireSupabase();
    const { data, error: err } = await sb
      .from("profiles")
      .select("role, full_name")
      .eq("id", user.value.id)
      .maybeSingle();
    if (err) {
      console.warn("profile load failed", err.message);
      profile.value = { role: "sales", full_name: null };
    } else {
      profile.value = data ?? { role: "sales", full_name: null };
    }
    profileLoaded.value = true;
  }

  async function init() {
    if (!supabaseConfigured) {
      profileLoaded.value = true;
      loading.value = false;
      return;
    }
    const sb = requireSupabase();
    const cache = useProductCacheStore();
    cache.hydrateFromStorage();

    const { data } = await sb.auth.getSession();
    user.value = data.session?.user ?? null;
    if (user.value) {
      await loadProfile();
      refreshProductCatalog().catch(() => {});
    } else {
      profileLoaded.value = true;
    }

    sb.auth.onAuthStateChange((event, session) => {
      user.value = session?.user ?? null;
      if (event === "SIGNED_IN" && session?.user) {
        loadProfile().then(() => refreshProductCatalog().catch(() => {}));
      }
      if (event === "SIGNED_OUT") {
        resetProfile();
        profileLoaded.value = true;
        clearProductCatalog();
      }
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
    await loadProfile();
    await refreshProductCatalog();
    return data;
  }

  async function signOut() {
    const sb = requireSupabase();
    await sb.auth.signOut();
    user.value = null;
    resetProfile();
    profileLoaded.value = true;
    clearProductCatalog();
  }

  return {
    user,
    profile,
    profileLoaded,
    role,
    isAdmin,
    isSales,
    displayName,
    loading,
    error,
    isAuthenticated,
    loadProfile,
    init,
    signIn,
    signOut,
  };
});
