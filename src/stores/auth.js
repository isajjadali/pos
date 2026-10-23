import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { requireSupabase, supabaseConfigured } from "../lib/supabase.js";
import { useProductCacheStore, clearProductCatalog, refreshProductCatalog } from "./productCache.js";
import { useMetaCacheStore, refreshMetaCache } from "./metaCache.js";

export const useAuthStore = defineStore("auth", () => {
  const user = ref(null);
  const profile = ref(null);
  const profileLoaded = ref(false);
  const loading = ref(true);
  const error = ref("");

  const isAuthenticated = computed(() => Boolean(user.value));

  const role = computed(() => {
    if (!supabaseConfigured) return "admin";
    if (!profileLoaded.value) return null;
    return String(profile.value?.role ?? "sales").toLowerCase();
  });

  const isAdmin = computed(() => !supabaseConfigured || role.value === "admin");
  const isSales = computed(() => supabaseConfigured && profileLoaded.value && role.value === "sales");
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
    // Keep previous profile visible while reloading — avoids sidebar/menu blink on tab focus
    const hadProfile = profileLoaded.value && profile.value;
    if (!hadProfile) profileLoaded.value = false;
    const sb = requireSupabase();
    const { data, error: err } = await sb
      .from("profiles")
      .select("role, full_name")
      .eq("id", user.value.id)
      .maybeSingle();
    if (err) {
      console.warn("profile load failed", err.message);
      if (!hadProfile) profile.value = { role: "sales", full_name: null };
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
    useMetaCacheStore().hydrateFromStorage();

    const { data } = await sb.auth.getSession();
    user.value = data.session?.user ?? null;
    if (user.value) {
      await loadProfile();
      refreshProductCatalog({ force: true }).catch(() => {});
      refreshMetaCache({ force: true }).catch(() => {});
    } else {
      profileLoaded.value = true;
    }

    sb.auth.onAuthStateChange((event, session) => {
      const nextUser = session?.user ?? null;
      const sameUser = nextUser?.id && nextUser.id === user.value?.id;
      user.value = nextUser;

      // Tab focus often re-emits SIGNED_IN / TOKEN_REFRESHED — don't reload UI for same session
      if (event === "SIGNED_IN" && nextUser && !sameUser) {
        loadProfile().then(() => {
          refreshProductCatalog({ force: true }).catch(() => {});
          refreshMetaCache({ force: true }).catch(() => {});
          import("../services/adminOutboxSync.js").then((m) => m.drainAllOfflineQueues());
        });
      } else if (event === "SIGNED_IN" && nextUser && sameUser && !profileLoaded.value) {
        loadProfile().then(() => {
          refreshProductCatalog({ force: true }).catch(() => {});
          refreshMetaCache({ force: true }).catch(() => {});
          import("../services/adminOutboxSync.js").then((m) => m.drainAllOfflineQueues());
        });
      }

      if (event === "SIGNED_OUT") {
        resetProfile();
        profileLoaded.value = true;
        clearProductCatalog();
        useMetaCacheStore().clear();
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
    await refreshProductCatalog({ force: true });
    await refreshMetaCache({ force: true }).catch(() => {});
    import("../services/adminOutboxSync.js").then((m) => m.drainAllOfflineQueues());
    return data;
  }

  async function signOut() {
    const sb = requireSupabase();
    await sb.auth.signOut();
    user.value = null;
    resetProfile();
    profileLoaded.value = true;
    clearProductCatalog();
    useMetaCacheStore().clear();
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
