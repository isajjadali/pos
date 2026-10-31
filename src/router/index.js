import { watch } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth.js";
import { supabaseConfigured } from "../lib/supabase.js";
import { navRouteKeysForUser } from "../config/navigation.js";
import { FEATURE_SHOPIFY } from "../config/features.js";

/*
 * Eager imports (not () => import(...)): offline / DevTools Offline must not
 * fetch new chunks from the Vite server when switching pages.
 */
import LoginView from "../views/LoginView.vue";
import AppLayout from "../layouts/AppLayout.vue";
import DashboardView from "../views/DashboardView.vue";
import InsightsView from "../views/InsightsView.vue";
import PosView from "../views/PosView.vue";
import ProductsView from "../views/ProductsView.vue";
import CategoriesView from "../views/CategoriesView.vue";
import PriceGroupsView from "../views/PriceGroupsView.vue";
import ShopifyOrdersView from "../views/ShopifyOrdersView.vue";
import ImportProductsView from "../views/ImportProductsView.vue";
import InventoryView from "../views/InventoryView.vue";
import BarcodePrintingView from "../views/BarcodePrintingView.vue";
import VendorsView from "../views/VendorsView.vue";
import SalesHistoryView from "../views/SalesHistoryView.vue";
import CustomItemsView from "../views/CustomItemsView.vue";
import AuditLogsView from "../views/AuditLogsView.vue";
import StaffUsersView from "../views/StaffUsersView.vue";
import SettingsView from "../views/SettingsView.vue";

const routes = [
  {
    path: "/login",
    name: "login",
    component: LoginView,
    meta: { public: true },
  },
  {
    path: "/",
    component: AppLayout,
    children: [
      { path: "", name: "dashboard", component: DashboardView },
      { path: "insights", name: "insights", component: InsightsView },
      { path: "pos", name: "pos", component: PosView },
      { path: "products", name: "products", component: ProductsView },
      { path: "categories", name: "categories", component: CategoriesView },
      { path: "price-groups", name: "price-groups", component: PriceGroupsView },
      ...(FEATURE_SHOPIFY
        ? [{ path: "shopify-orders", name: "shopify-orders", component: ShopifyOrdersView }]
        : []),
      { path: "import", name: "import", component: ImportProductsView },
      { path: "inventory", name: "inventory", component: InventoryView },
      { path: "barcodes", name: "barcodes", component: BarcodePrintingView },
      { path: "vendors", name: "vendors", component: VendorsView },
      { path: "sales", name: "sales", component: SalesHistoryView },
      { path: "custom-items", name: "custom-items", component: CustomItemsView },
      { path: "audit-logs", name: "audit-logs", component: AuditLogsView },
      { path: "staff", name: "staff", component: StaffUsersView },
      { path: "settings", name: "settings", component: SettingsView },
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
