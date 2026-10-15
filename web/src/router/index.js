import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth.js";
import { supabaseConfigured } from "../lib/supabase.js";
import { ADMIN_ONLY_ROUTES } from "../config/navigation.js";

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

router.beforeEach(async (to) => {
  const auth = useAuthStore();

  if (to.meta.public) {
    if (supabaseConfigured && auth.isAuthenticated && to.name === "login") {
      return { name: auth.isAdmin ? "dashboard" : "pos" };
    }
    return true;
  }

  if (!supabaseConfigured) return true;

  if (!auth.isAuthenticated) return { name: "login", query: { redirect: to.fullPath } };

  if (!auth.profileLoaded) {
    await auth.loadProfile();
  }

  if (ADMIN_ONLY_ROUTES.has(to.name) && !auth.isAdmin) {
    return { name: "pos" };
  }

  if (to.name === "dashboard" && !auth.isAdmin) {
    return { name: "pos" };
  }

  return true;
});

export default router;
