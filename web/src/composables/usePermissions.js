import { computed } from "vue";
import { useAuthStore } from "../stores/auth.js";

export function usePermissions() {
  const auth = useAuthStore();

  const isAdmin = computed(() => auth.isAdmin);
  const isSales = computed(() => auth.isSales);

  const canManageProducts = computed(() => auth.isAdmin);
  const canSeePurchasePrices = computed(() => auth.isAdmin);
  const canManageInventory = computed(() => auth.isAdmin);
  const canAccessSettings = computed(() => auth.isAdmin);
  const canImportProducts = computed(() => auth.isAdmin);
  const canManageVendors = computed(() => auth.isAdmin);
  const canPrintBarcodes = computed(() => auth.isAdmin);
  const canViewSalesHistory = computed(() => auth.isAdmin);
  const canManageStaff = computed(() => auth.isAdmin);
  const canUsePos = computed(() => true);

  const defaultHomeRoute = computed(() => (auth.isAdmin ? "dashboard" : "pos"));

  return {
    isAdmin,
    isSales,
    canManageProducts,
    canSeePurchasePrices,
    canManageInventory,
    canAccessSettings,
    canImportProducts,
    canManageVendors,
    canPrintBarcodes,
    canViewSalesHistory,
    canManageStaff,
    canUsePos,
    defaultHomeRoute,
  };
}
