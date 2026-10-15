import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth.js";
import { supabaseConfigured } from "../lib/supabase.js";

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
      { path: "settings", name: "settings", component: () => import("../views/SettingsView.vue") },
    ],
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  if (to.meta.public) return true;
  if (!supabaseConfigured) return true;
  const auth = useAuthStore();
  if (!auth.isAuthenticated) return { name: "login", query: { redirect: to.fullPath } };
  return true;
});

export default router;
