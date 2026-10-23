import {
  HomeOutline,
  CartOutline,
  CubeOutline,
  CloudUploadOutline,
  LayersOutline,
  BarcodeOutline,
  BusinessOutline,
  ReceiptOutline,
  SettingsOutline,
  PeopleOutline,
  PricetagOutline,
  BagHandleOutline,
  FolderOpenOutline,
  AnalyticsOutline,
  StatsChartOutline,
  ConstructOutline,
} from "@vicons/ionicons5";
import { FEATURE_SHOPIFY } from "./features.js";

/**
 * Nested sidebar tree.
 * Leaf `key` = vue-router route name.
 * Parent groups have `children` and are not routes.
 *
 * Outside (daily ops): Dashboard, POS, Products, Categories, Vendors, Settings.
 * Reports: Insights, Sales History, Price groups.
 * Operations: Inventory, Barcodes, Import, Shopify.
 * Admin: Staff.
 */
export const NAV_ITEMS = [
  { label: "Dashboard", key: "dashboard", icon: HomeOutline, adminOnly: true },
  { label: "POS / New Sale", key: "pos", icon: CartOutline, adminOnly: false },
  { label: "Products", key: "products", icon: CubeOutline, adminOnly: false },
  { label: "Categories", key: "categories", icon: FolderOpenOutline, adminOnly: true },
  { label: "Vendors", key: "vendors", icon: BusinessOutline, adminOnly: true },
  {
    label: "Reports",
    key: "nav-reports",
    icon: StatsChartOutline,
    adminOnly: true,
    children: [
      { label: "Insights", key: "insights", icon: AnalyticsOutline, adminOnly: true },
      { label: "Sales History", key: "sales", icon: ReceiptOutline, adminOnly: true },
      { label: "Price groups", key: "price-groups", icon: PricetagOutline, adminOnly: true },
    ],
  },
  {
    label: "Operations",
    key: "nav-operations",
    icon: ConstructOutline,
    adminOnly: true,
    children: [
      { label: "Inventory", key: "inventory", icon: LayersOutline, adminOnly: true },
      { label: "Barcode Printing", key: "barcodes", icon: BarcodeOutline, adminOnly: true },
      { label: "Import Products", key: "import", icon: CloudUploadOutline, adminOnly: true },
      {
        label: "Shopify Orders",
        key: "shopify-orders",
        icon: BagHandleOutline,
        adminOnly: true,
        feature: "shopify",
      },
    ],
  },
  { label: "Staff users", key: "staff", icon: PeopleOutline, adminOnly: true },
  { label: "Settings", key: "settings", icon: SettingsOutline, adminOnly: true },
];

function featureEnabled(item) {
  if (item.feature === "shopify") return FEATURE_SHOPIFY;
  return true;
}

function isLeaf(item) {
  return !item.children?.length;
}

/** Depth-first leaf routes (for guards, hotkeys, titles). */
export function flattenNavLeaves(items) {
  const out = [];
  for (const item of items) {
    if (item.children?.length) out.push(...flattenNavLeaves(item.children));
    else if (isLeaf(item)) out.push(item);
  }
  return out;
}

function filterNavTree(items, isAdmin) {
  const out = [];
  for (const item of items) {
    if (!featureEnabled(item)) continue;
    if (item.adminOnly && !isAdmin) continue;
    if (item.children?.length) {
      const children = filterNavTree(item.children, isAdmin);
      if (!children.length) continue;
      out.push({ ...item, children });
      continue;
    }
    out.push(item);
  }
  return out;
}

export function visibleNavItems(isAdmin) {
  return filterNavTree(NAV_ITEMS, isAdmin);
}

export const ADMIN_ONLY_ROUTES = new Set(
  flattenNavLeaves(NAV_ITEMS).filter((i) => i.adminOnly).map((i) => i.key)
);

export function navRouteKeysForUser(isAdmin) {
  return flattenNavLeaves(visibleNavItems(isAdmin)).map((item) => item.key);
}

export function findNavLeaf(isAdmin, routeKey) {
  return flattenNavLeaves(visibleNavItems(isAdmin)).find((i) => i.key === routeKey) || null;
}

/** Parent group keys that should stay expanded for the active route. */
export function expandedNavKeysForRoute(isAdmin, routeKey) {
  const tree = visibleNavItems(isAdmin);
  const keys = [];
  for (const item of tree) {
    if (!item.children?.length) continue;
    if (item.children.some((c) => c.key === routeKey)) keys.push(item.key);
  }
  return keys;
}
