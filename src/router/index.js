import { watch } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth.js";
import { supabaseConfigured } from "../lib/supabase.js";
import { navRouteKeysForUser } from "../config/navigation.js";

const routes = [
  {
    path: "/login",
    name: "login",
    component: () => import("../views/LoginView.vue"),
    meta: { public: true },
  },
  {
    path: "/",
    component: () => import("../layouts/AppLayout.vue"),
    children: [
      { path: "", name: "dashboard", component: () => import("../views/DashboardView.vue") },
      { path: "pos", name: "pos", component: () => import("../views/PosView.vue") },
      { path: "products", name: "products", component: () => import("../views/ProductsView.vue") },
      {
        path: "price-groups",
        name: "price-groups",
        component: () => import("../views/PriceGroupsView.vue"),
      },
      {
        path: "shopify-orders",
        name: "shopify-orders",
        component: () => import("../views/ShopifyOrdersView.vue"),
      },
      { path: "import", name: "import", component: () => import("../views/ImportProductsView.vue") },
      { path: "inventory", name: "inventory", component: () => import("../views/InventoryView.vue") },
      { path: "barcodes", name: "barcodes", component: () => import("../views/BarcodePrintingView.vue") },
      { path: "vendors", name: "vendors", component: () => import("../views/VendorsView.vue") },
      { path: "sales", name: "sales", component: () => import("../views/SalesHistoryView.vue") },
      { path: "staff", name: "staff", component: () => import("../views/StaffUsersView.vue") },
      { path: "settings", name: "settings", component: () => import("../views/SettingsView.vue") },
    ],
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

function waitForAuthBootstrap(auth) {
  if (!auth.loading) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = watch(
      () => auth.loading,
      (loading) => {
        if (!loading) {
          stop();
          resolve();
        }
      },
      { immediate: true }
    );
  });
}

async function ensureSessionAndProfile(auth) {
  await waitForAuthBootstrap(auth);
  if (auth.isAuthenticated && !auth.profileLoaded) {
    await auth.loadProfile();
  }
}

router.beforeEach(async (to) => {
  const auth = useAuthStore();

  await ensureSessionAndProfile(auth);

  if (to.meta.public) {
    if (supabaseConfigured && auth.isAuthenticated && to.name === "login") {
      const redirect = to.query.redirect;
      if (typeof redirect === "string" && redirect.startsWith("/")) {
        return redirect;
      }
      return { name: auth.isAdmin ? "dashboard" : "pos" };
    }
    return true;
  }

  if (!supabaseConfigured) return true;

  if (!auth.isAuthenticated) {
    return { name: "login", query: { redirect: to.fullPath } };
  }

  if (!auth.profileLoaded) {
    return true;
  }

  const allowed = navRouteKeysForUser(auth.isAdmin);
  if (!allowed.includes(to.name)) {
    return { name: allowed[0] ?? "pos" };
  }

  return true;
});

export default router;
